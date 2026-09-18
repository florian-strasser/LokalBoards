<script setup>
import { socket } from "~/lib/socket";

const props = defineProps({
    boardID: String,
    userID: String,
});

const emits = defineEmits([
    "board-updated",
    "board-members-updated",
    "board-deleted",
    "areas-updated",
    "area-created",
    "area-updated",
    "area-deleted",
    "card-created",
    "card-updated",
    "card-moved",
    "card-orderd",
    "card-deleted",
    "comment-count-updated",
    "presence-updated",
]);

const isThisBoard = (boardId) => props.boardID * 1 === boardId * 1;

// (Re)join the board room. This must run on every (re)connect, but the event
// listeners below are registered only once so they don't stack up across
// reconnects (which previously caused signals to be handled multiple times).
const joinBoard = () => {
    if (props.boardID) {
        socket.emit("joinBoard", {
            boardId: props.boardID,
        });
    }
};

const onUpdateBoard = ({
    boardID,
    boardName,
    boardStatus,
    boardStyle,
    boardImage,
    boardColor,
}) => {
    if (isThisBoard(boardID))
        emits("board-updated", {
            boardID,
            boardName,
            boardStatus,
            boardStyle,
            boardImage,
            boardColor,
        });
};

// Somebody was invited to this board or taken off it.
const onBoardMembers = ({ boardID }) => {
    if (isThisBoard(boardID)) emits("board-members-updated");
};

const onDeletedBoard = ({ boardID }) => {
    if (isThisBoard(boardID)) emits("board-deleted", boardID);
};

const onUpdateAreas = ({ areas, boardId }) => {
    if (isThisBoard(boardId)) emits("areas-updated", areas);
};

const onAddCard = ({ card, boardId, after }) => {
    if (isThisBoard(boardId)) emits("card-created", card, after);
};

const onUpdateCard = ({ card, boardId }) => {
    if (isThisBoard(boardId)) emits("card-updated", card);
};

const onMovedCard = ({ cardId, fromAreaId, toAreaId, newIndex, boardId }) => {
    if (isThisBoard(boardId))
        emits("card-moved", { cardId, fromAreaId, toAreaId, newIndex });
};

const onDeletedCard = ({ boardId, card }) => {
    if (isThisBoard(boardId)) emits("card-deleted", card);
};

const onOrderdCard = ({ cardId, areaId, newIndex, boardId }) => {
    if (isThisBoard(boardId))
        emits("card-orderd", { cardId, areaId, newIndex });
};

const onAddArea = ({ area, boardId }) => {
    if (isThisBoard(boardId)) emits("area-created", area);
};

const onUpdateArea = ({ area, boardId }) => {
    if (isThisBoard(boardId)) emits("area-updated", area);
};

const onDeleteArea = ({ area, boardId }) => {
    if (isThisBoard(boardId)) emits("area-deleted", area);
};

// Live presence. `cardPresence` is a single card changing; `boardPresence` is
// the snapshot the server sends when we join, so tiles show faces immediately
// instead of only after the next change.
const onCardPresence = ({ cardID, users }) => {
    emits("presence-updated", [{ cardID, users }]);
};

const onBoardPresence = ({ boardId, cards }) => {
    if (isThisBoard(boardId)) emits("presence-updated", cards || [], true);
};

const onCommentCountUpdated = ({ cardId, commentCount, boardId }) => {
    if (isThisBoard(boardId))
        emits("comment-count-updated", { cardId, commentCount });
};

// Register each listener exactly once. Using named handlers means a reconnect
// re-runs joinBoard (via the "connect" event) without re-adding these, and
// they can be cleanly removed on unmount.
socket.on("connect", joinBoard);
socket.on("updateBoard", onUpdateBoard);
socket.on("deletedBoard", onDeletedBoard);
socket.on("boardMembersUpdated", onBoardMembers);
socket.on("updateAreas", onUpdateAreas);
socket.on("addCard", onAddCard);
socket.on("updateCard", onUpdateCard);
socket.on("movedCard", onMovedCard);
socket.on("deletedCard", onDeletedCard);
socket.on("orderdCard", onOrderdCard);
socket.on("addArea", onAddArea);
socket.on("updateArea", onUpdateArea);
socket.on("deleteArea", onDeleteArea);
socket.on("commentCountUpdated", onCommentCountUpdated);
socket.on("cardPresence", onCardPresence);
socket.on("boardPresence", onBoardPresence);

// Join immediately if the socket is already connected.
if (socket.connected) {
    joinBoard();
}

onBeforeUnmount(() => {
    socket.off("connect", joinBoard);
    socket.off("updateBoard", onUpdateBoard);
    socket.off("deletedBoard", onDeletedBoard);
    socket.off("boardMembersUpdated", onBoardMembers);
    socket.off("updateAreas", onUpdateAreas);
    socket.off("addCard", onAddCard);
    socket.off("updateCard", onUpdateCard);
    socket.off("movedCard", onMovedCard);
    socket.off("deletedCard", onDeletedCard);
    socket.off("orderdCard", onOrderdCard);
    socket.off("addArea", onAddArea);
    socket.off("updateArea", onUpdateArea);
    socket.off("deleteArea", onDeleteArea);
    socket.off("commentCountUpdated", onCommentCountUpdated);
    socket.off("cardPresence", onCardPresence);
    socket.off("boardPresence", onBoardPresence);
});
</script>
<template><div></div></template>
