<template>
  <section id="pricing" class="section">
    <div class="container">
      <!-- The eyebrow answers the question, and the heading only names the
           section the question was asked about. A visitor scanning for a price
           gets the whole answer before they reach the heading. -->
      <SplitText
        as="p"
        text="Free and open source"
        :stagger="0.02"
        class="text-primary sm:text-lg"
      />
      <SplitText
        as="h2"
        text="Pricing"
        :delay="0.2"
        class="text-dark mb-8 text-3xl xs:text-4xl sm:text-5xl"
      />

      <!-- Two cards, and the free one is the filled card on the left: the
           software is the point of the page, and the service is an offer beside
           it rather than a tier above it. The second card says so in as many
           words, because two prices side by side otherwise read as two editions
           of the product — there is still only one build, and it is free.

           Before this there was one block and no comparison. An older version
           had two cards with a list of lines under each, but with nothing to
           compare against most of those lines were chores dressed as features:
           "You apply the updates" is what self-hosting means, not something on
           offer. Neither card carries a feature list for that reason. -->
      <!-- No `items-start`: the cards stretch to the taller of the two, so the
           pair reads as one row rather than two blocks that drift apart as the
           copy in either one changes. Each card is then a column with the button
           held to its bottom edge by `mt-auto`, so the two buttons line up
           whatever is written above them. -->
      <div class="mx-auto grid gap-6 md:grid-cols-2">
        <FadeIn
          class="bg-slate flex flex-col rounded-3xl p-8 text-center sm:p-10"
          :amount="0.15"
        >
          <p class="text-gray text-sm font-medium tracking-wide uppercase">
            Self-hosted
          </p>
          <p
            class="text-dark mt-3 text-6xl font-semibold tracking-tight sm:text-7xl"
          >
            0 €
          </p>
          <p class="text-gray mt-2">Forever, for any number of people</p>

          <p class="text-dark mt-6">
            LokalBoards is open source under the MIT licence. There is no paid
            tier, no seat limit and no edition held back — a team of five and a
            team of five hundred install the same build. What it costs you is
            the server it runs on.
          </p>

          <div class="mt-auto pt-8 flex flex-col justify-center gap-3 xs:flex-row">
            <NuxtLink
              to="/docs/"
              class="bg-primary hover:bg-primary-hover rounded-full px-6 py-3 font-medium text-white transition-colors"
              >Getting started</NuxtLink
            >
          </div>
        </FadeIn>

        <FadeIn
          class="bg-primary/10 flex flex-col rounded-3xl p-8 text-center sm:p-10"
          :amount="0.15"
          :delay="0.1"
        >
          <p class="text-gray text-sm font-medium tracking-wide uppercase">
            Setup service
          </p>
          <p
            class="text-dark mt-3 text-6xl font-semibold tracking-tight sm:text-7xl"
          >
            299 €
          </p>
          <p class="text-gray mt-2">One-time</p>

          <p class="text-dark mt-6">
            Don't want to touch a terminal? I'll install LokalBoards on your
            server and hand you the keys. The software is still free — this pays for my time, not a licence.
            The server is rented from your hosting provider and billed by them.
          </p>

          <div class="mt-auto pt-8 flex justify-center">
            <a
              href="mailto:kontakt@florian-strasser.de?subject=LokalBoards%20Setup%20Service%20request"
              class="bg-primary hover:bg-primary-hover rounded-full px-6 py-3 font-medium text-white transition-colors"
              >Get in touch</a
            >
          </div>
        </FadeIn>
      </div>
    </div>
  </section>
</template>
