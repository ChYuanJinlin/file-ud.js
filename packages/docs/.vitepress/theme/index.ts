import DefaultTheme from "vitepress/theme";
import type { Theme } from "vitepress";
import VersionSwitcher from "./VersionSwitcher.vue";
import Layout from "./Layout.vue";

export default {
  extends: DefaultTheme,
  Layout,
  enhanceApp({ app }) {
    app.component("VersionSwitcher", VersionSwitcher);
  },
} satisfies Theme;
