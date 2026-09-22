<template>
  <section id="features" class="section">
    <div class="container">
      <SplitText
        as="p"
        text="What you can do"
        :stagger="0.02"
        class="text-primary sm:text-lg"
      />
      <SplitText
        as="h2"
        text="Features"
        :delay="0.2"
        class="text-dark mb-8 text-3xl xs:text-4xl sm:text-5xl"
      />

      <!-- Every tile carries a piece of the actual interface. Some of those
           pieces move and some stand still, and they are interleaved rather
           than sorted — a block of animation followed by a block of prose reads
           as two different sections. Everything moving loops forever and needs
           no scroll position, so nothing is caught half-finished if you arrive
           at the section and stop. -->
      <div class="grid gap-4 lg:grid-cols-6">
        <FeatureTile
          class="lg:col-span-4"
          tall
          title="Everyone sees it the moment it happens"
          text="Boards are live for everyone on them. Cards move, comments land and progress updates without a refresh, and you can see who else has the card open at the same time as you. And if you are not sitting in front of it when something happens, you are not going to miss it: an e-mail goes out once an hour with everything that changed on the boards you are on."
        >
          <FeatureRealtime />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          tall
          title="A colour, or a picture"
          text="Give a board one of twelve presets, or upload your own cover image. Every preset is checked for contrast, so the title stays readable whichever you pick."
        >
          <FeatureColors />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          title="Share a board, set the roles"
          text="Invite anyone by e-mail. Owners administer the board, members work on it, and read-only guests follow along without changing a thing. Take any of it back whenever you like."
        >
          <FeatureInvite />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          title="Ten languages"
          text="English, German, French, Spanish, Italian, Dutch, Polish, Ukrainian, Portuguese and Czech — every string of it, not a partial locale that falls back halfway through."
        >
          <FeatureLanguages />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          title="Runs on your own hardware"
          text="One container on your own machine. It carries a MySQL of its own, so there is nothing to provision first, and pointing it at an external database is one variable away."
        >
          <FeatureDocker />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          title="Checklists that count themselves"
          text="Write a list in the card description and the card keeps the score, counting itself up as the boxes are ticked. Nothing to switch on and nothing to learn — it is ordinary Markdown."
        >
          <FeatureChecklist />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          title="An API, and a server for agents"
          text="Everything the interface does, a scoped API key can do too, and the MCP server lets an assistant work the board directly. Agent accounts are marked, so it is clear who did what."
        >
          <FeatureApi />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          title="Two ways to look at a board"
          text="Columns when you are moving work through stages, a single list when you are working down it. Same board and same cards either way — the layout is only a way of looking at them."
        >
          <FeatureLayouts />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          title="Light and dark, done properly"
          text="Follows whatever your system is set to and switches the moment you do. The dark palette is its own set of colours, not the light one inverted, with the blues lifted so they still read."
        >
          <FeatureDarkMode />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          title="Bring your board over from Trello"
          text="Paste a link to a public board, or choose a private board's export file, and it is recreated here: lists, cards, descriptions, checklists, labels, due dates, comments and what was already done. Coming from Wekan or Nextcloud Deck instead? Their export files come across too."
        >
          <FeatureTrello />
        </FeatureTile>

        <FeatureTile
          class="lg:col-span-2"
          title="Open source, made in Europe"
          text="MIT licensed, written in Germany and running wherever you put it. No American cloud stands between your team and its own data, and there is nobody to phone home to."
        >
          <FeatureEurope />
        </FeatureTile>
      </div>
    </div>
  </section>
</template>
