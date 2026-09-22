<template>
  <section id="faq" class="section">
    <div class="container">
      <SplitText
        as="p"
        text="Frequently asked"
        :stagger="0.02"
        class="text-primary sm:text-lg"
      />
      <SplitText
        as="h2"
        text="Questions"
        :delay="0.2"
        class="text-dark mb-4 text-3xl xs:text-4xl sm:text-5xl"
      />

      <FaqItem
        v-for="(item, index) in faq"
        :key="index"
        :frage="item.frage"
        :antwort="item.antwort"
        :index="index"
      />
    </div>
  </section>
</template>

<script setup lang="ts">
const faq = [
  {
    frage: "Is LokalBoards really free?",
    antwort:
      "<p>Yes. It is open source under the MIT licence, with no paid tier, no seat limit and no feature held back — a team of five and a team of five hundred run the same build. It costs you what the server it runs on costs.</p>",
  },
  {
    frage: "Where is my data stored?",
    antwort:
      "<p>In your own MySQL database, on your own machine. LokalBoards does not phone home and has no telemetry. The only traffic that leaves your server is what you configure yourself: outgoing e-mail through your SMTP server, and any webhooks you set up.</p>",
  },
  {
    frage: "Do I need to set up a database?",
    antwort:
      "<p>Not to get started. The Docker image carries its own MySQL, so a single <code>docker run</code> gives you a working instance with nothing else to install.</p><p>For anything long-lived a separate database is the better arrangement — it can be backed up, upgraded and monitored on its own schedule. Point <code>NUXT_MYSQL_HOST</code> at it and the built-in one never starts.</p>",
  },
  {
    frage: "How do AI agents fit in?",
    antwort:
      "<p>LokalBoards ships a Model Context Protocol server, so an assistant can read a board, create and move cards, write comments and set due dates — through an API key you issue and can revoke at any time.</p><p>Keys are scoped: a read-only key can look but never change anything. Agent accounts are marked with their own icon, so it is always clear who did what.</p>",
  },
  {
    frage: "What happens if we delete something by accident?",
    antwort:
      "<p>Backups are yours to arrange, and there is nothing special to it: the data is an ordinary MySQL database and the attachments are ordinary files, so whatever you already back up with will do.</p><p>Restoring is the same in reverse — put the database back and the attachments with it. Nothing about LokalBoards has to be told that it happened.</p>",
  },
  {
    frage: "Can I bring my boards over from Trello, Wekan or Nextcloud Deck?",
    antwort:
      "<p>Yes. Paste a link to a public Trello board, or choose the export file Trello, Wekan or Nextcloud Deck writes — which is how a private Trello board comes over — and LokalBoards recreates the boards: lists, cards, descriptions, checklists, labels, due dates, comments and what was already done, and the attachments wherever the export makes that possible.</p>",
  },
  {
    frage: "Which languages are available?",
    antwort:
      "<p>Ten: English, German, French, Spanish, Italian, Dutch, Polish, Ukrainian, Portuguese and Czech. Translations are community-improvable — each language is a single JSON file, and corrections are welcome as a pull request.</p>",
  },
];

// The structured data the copied component used to emit per question, as one
// FAQPage block for the whole list. This is what Google's FAQ rich result
// expects, and it avoids pulling in the @nuxtjs/seo bundle — which this site
// dropped because it depends on `image-size`, still carrying two unpatched
// high-severity advisories.
useHead({
  script: [
    {
      type: "application/ld+json",
      innerHTML: JSON.stringify({
        "@context": "https://schema.org",
        "@type": "FAQPage",
        mainEntity: faq.map((item) => ({
          "@type": "Question",
          name: item.frage,
          acceptedAnswer: {
            "@type": "Answer",
            // Rich results want the answer as text, not markup.
            text: item.antwort.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
          },
        })),
      }),
    },
  ],
});
</script>
