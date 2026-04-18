<script setup lang="ts">
import { computed } from 'vue'
import type { LanguageIconId } from '../graph/languages'

import scala from '../assets/language-icons/scala.svg'
import typescript from '../assets/language-icons/typescript.svg'
import javascript from '../assets/language-icons/javascript.svg'
import python from '../assets/language-icons/python.svg'
import java from '../assets/language-icons/java.svg'
import rust from '../assets/language-icons/rust.svg'
import go from '../assets/language-icons/go.svg'
import kotlin from '../assets/language-icons/kotlin.svg'
import ruby from '../assets/language-icons/ruby.svg'
import swift from '../assets/language-icons/swift.svg'
import generic from '../assets/language-icons/generic.svg'

const props = defineProps<{
  name: LanguageIconId
}>()

const sources: Record<LanguageIconId, string> = {
  scala,
  ts: typescript,
  js: javascript,
  python,
  java,
  rust,
  go,
  kotlin,
  ruby,
  swift,
}

const src = computed(() => sources[props.name] ?? generic)
</script>

<template>
  <img
    class="lang-svg"
    :src="src"
    alt=""
    width="24"
    height="24"
    decoding="async"
    aria-hidden="true"
  />
</template>

<style scoped>
.lang-svg {
  display: block;
  height: 100%;
  width: auto;
  max-width: min(40cqw, 96px);
  object-fit: contain;
}
</style>
