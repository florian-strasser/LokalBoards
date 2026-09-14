# Driven by nix/test.nix. `machine` and `subtest` come from the NixOS test driver.
import json
import re
import shlex
from datetime import timedelta

BASE = "http://127.0.0.1"
ADMIN = {"email": "admin@example.test", "password": "test-admin-password"}


def sign_in(base: str, extra: str = "") -> str:
    """The Set-Cookie line for the session, from signing in as the first admin."""
    headers = machine.succeed(
        f"curl -sf -D - -o /dev/null {extra} -H 'content-type: application/json' "
        f"-d {shlex.quote(json.dumps(ADMIN))} {base}/api/auth/sign-in"
    )
    line = re.search(r"^set-cookie: session_token=[^\r\n]*", headers, re.IGNORECASE | re.MULTILINE)
    assert line is not None, f"no session cookie in:\n{headers}"
    return line.group(0)


def is_secure(cookie: str) -> bool:
    return re.search(r";\s*secure", cookie, re.IGNORECASE) is not None


def send_json(method: str, path: str, body: object, cookie: str) -> dict:
    return json.loads(
        machine.succeed(
            f"curl -sf -X {method} -H {shlex.quote('Cookie: ' + cookie)} "
            f"-H 'content-type: application/json' -d {shlex.quote(json.dumps(body))} {BASE}{path}"
        )
    )


def logged_errors() -> str:
    # The app logs JSON to stdout, which journald files at info priority, so
    # errors are found by their level rather than by `journalctl -p err`.
    return machine.succeed("journalctl -u lokalboards -b -o cat | grep '\"level\":\"error\"' || true").strip()


def wait_until_serving() -> None:
    machine.wait_for_unit("mysql.service")
    machine.wait_for_unit("lokalboards.service")
    machine.wait_for_unit("nginx.service")
    machine.wait_until_succeeds(f"curl -sf {BASE}/api/health", timeout=timedelta(minutes=5))


machine.start()
wait_until_serving()

with subtest("the module creates the database, and the guide's user logs in over TCP"):
    machine.succeed("mysql -N -e \"SHOW DATABASES LIKE 'lokalboards'\" | grep -qx lokalboards")
    machine.succeed(
        "mysql -N -e \"SELECT CONCAT(user, '@', host) FROM mysql.user WHERE user = 'lokalboards'\""
        " | grep -qx lokalboards@localhost"
    )
    migrations = int(
        machine.succeed(
            "mysql -h 127.0.0.1 -u lokalboards -ptest-password -N"
            " -e 'SELECT COUNT(*) FROM lokalboards.migrations'"
        ).strip()
    )
    assert migrations > 0, "the app ran no migrations"

with subtest("the first admin signs in through nginx, with a cookie that fits the transport"):
    plain = sign_in(BASE)
    assert not is_secure(plain), f"Secure over plain HTTP, so browsers would drop it: {plain}"
    behind_tls = sign_in(f"{BASE}:3000", "-H 'X-Forwarded-Proto: https'")
    assert is_secure(behind_tls), f"not Secure behind a TLS proxy: {behind_tls}"
    token = re.search(r"session_token=[^;]+", plain)
    assert token is not None
    cookie = token.group(0)
    session = json.loads(machine.succeed(f"curl -sf -H {shlex.quote('Cookie: ' + cookie)} {BASE}/api/auth/get-session"))
    assert session["data"]["user"]["role"] == "admin", session

with subtest("live updates: a websocket upgrade gets through nginx"):
    status = machine.succeed(
        "curl -s -o /dev/null -w '%{http_code}' --max-time 3"
        " -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13'"
        " -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ=='"
        " 'http://127.0.0.1/socket.io/?EIO=4&transport=websocket' || true"
    ).strip()
    assert status == "101", f"the websocket upgrade was answered with {status}"

with subtest("a board with an uploaded attachment, and a file bigger than nginx's default limit"):
    me = session["data"]["user"]["id"]
    # Only the required fields: `image` and `color` are optional.
    board = send_json("POST", "/api/data/board", {"userId": me, "name": "Module test", "style": "kanban", "status": "private"}, cookie)["board"]["id"]
    area = send_json("POST", "/api/data/area", {"boardId": board, "name": "Todo"}, cookie)["area"]["id"]
    card = send_json("POST", "/api/data/card", {"areaId": area, "name": "Boot NixOS"}, cookie)["card"]["id"]

    machine.succeed("printf '%%PDF-1.4\\n%%%%EOF\\n' > /var/tmp/small.pdf")
    machine.succeed("{ printf '%%PDF-1.4\\n'; head -c 5242880 /dev/zero; } > /var/tmp/big.pdf")
    upload = f"curl -sf -H {shlex.quote('Cookie: ' + cookie)} {BASE}/api/upload -F"
    small_url = json.loads(machine.succeed(f"{upload} 'file=@/var/tmp/small.pdf;type=application/pdf'"))["url"]
    big_url = json.loads(machine.succeed(f"{upload} 'file=@/var/tmp/big.pdf;type=application/pdf'"))["url"]
    assert big_url, "the 5 MB upload did not get through nginx"

    size = int(machine.succeed("stat -c %s /var/tmp/small.pdf").strip())
    send_json(
        "PUT",
        "/api/data/card",
        {"cardID": card, "name": "Boot NixOS", "files": [{"filename": "small.pdf", "filetype": "application/pdf", "filesize": size, "filedata": small_url}]},
        cookie,
    )
    attachment = machine.succeed(f"mysql -N -e 'SELECT id FROM lokalboards.attachments WHERE card = {card}'").strip()
    assert attachment, "the card has no attachment"


def assert_stored() -> None:
    machine.succeed(f"mysql -N -e 'SELECT name FROM lokalboards.boards WHERE id = {board}' | grep -qx 'Module test'")
    machine.succeed(
        f"curl -sf -H {shlex.quote('Cookie: ' + cookie)} '{BASE}/api/data/attachment?id={attachment}&download=1'"
        " -o /var/tmp/downloaded.pdf"
    )
    machine.succeed("cmp /var/tmp/small.pdf /var/tmp/downloaded.pdf")
    machine.succeed(f"test -f /var/lib/lokalboards/public/uploads/{small_url.rsplit('/', 1)[-1]}")


with subtest("what was stored is where it belongs"):
    assert_stored()
    assert logged_errors() == "", logged_errors()

with subtest("all of it comes back after a reboot"):
    machine.shutdown()
    machine.start()
    wait_until_serving()
    assert not is_secure(sign_in(BASE))
    assert_stored()
    assert logged_errors() == "", logged_errors()
