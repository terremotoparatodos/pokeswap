<template>
  <main class="swap-retired">
    <p class="swap-retired-notice">{{ SWAP_RETIRED_NOTICE }}</p>
  </main>
</template>

<script setup lang="ts">
import { SWAP_RETIRED_NOTICE } from '../retired'

// What /swap and the Silph Co. door show now. Deliberately static: no session,
// no API, no store — nothing here can start a trade.
</script>

<style scoped>
.swap-retired {
  padding: 1.5rem 1rem;
  text-align: center;
}

.swap-retired-notice {
  margin: 0;
  line-height: 1.5;
}
</style>
