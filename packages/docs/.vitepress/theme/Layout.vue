<script setup lang="ts">
import DefaultTheme from "vitepress/theme";
import VersionSwitcher from "./VersionSwitcher.vue";

const { Layout } = DefaultTheme;
</script>

<template>
  <Layout>
    <template #nav-bar-content-after>
      <VersionSwitcher />
    </template>
  </Layout>
</template>
