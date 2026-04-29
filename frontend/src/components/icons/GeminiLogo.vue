<script setup lang="ts">
// Google Gemini 官方品牌 logo（彩色四瓣星，藍底 + 綠/紅/黃漸層覆蓋）
interface Props {
  size?: number | string;
  class?: string;
}

withDefaults(defineProps<Props>(), {
  size: 24,
  class: "",
});
</script>

<template>
  <svg
    :width="size"
    :height="size"
    viewBox="0 0 24 24"
    xmlns="http://www.w3.org/2000/svg"
  >
    <title>Gemini</title>
    <defs>
      <path
        id="g-s"
        d="M20.6 10.8a14.1 14.1 0 01-4.5-3 14.1 14.1 0 01-3.7-6.5.5.5 0 00-1 0 14.1 14.1 0 01-3.7 6.5 14.2 14.2 0 01-4.5 3c-.7.3-1.3.5-2 .7a.5.5 0 000 1c.7.2 1.4.4 2 .7a14.1 14.1 0 014.5 3 14.1 14.1 0 013.7 6.5.5.5 0 001 0c.2-.7.4-1.4.7-2a14.1 14.1 0 013-4.5 14.1 14.1 0 016.5-3.7.5.5 0 000-1 13.2 13.2 0 01-2-.7z"
      />
      <linearGradient
        id="g-0"
        gradientUnits="userSpaceOnUse"
        x1="7"
        x2="11"
        y1="15.5"
        y2="12"
      >
        <stop stop-color="#08B962" />
        <stop offset="1" stop-color="#08B962" stop-opacity="0" />
      </linearGradient>
      <linearGradient
        id="g-1"
        gradientUnits="userSpaceOnUse"
        x1="8"
        x2="11.5"
        y1="5.5"
        y2="11"
      >
        <stop stop-color="#F94543" />
        <stop offset="1" stop-color="#F94543" stop-opacity="0" />
      </linearGradient>
      <linearGradient
        id="g-2"
        gradientUnits="userSpaceOnUse"
        x1="3.5"
        x2="17.5"
        y1="13.5"
        y2="12"
      >
        <stop stop-color="#FABC12" />
        <stop offset=".46" stop-color="#FABC12" stop-opacity="0" />
      </linearGradient>
    </defs>
    <use href="#g-s" fill="#3186FF" />
    <use href="#g-s" fill="url(#g-0)" />
    <use href="#g-s" fill="url(#g-1)" />
    <use href="#g-s" fill="url(#g-2)" />
  </svg>
</template>
