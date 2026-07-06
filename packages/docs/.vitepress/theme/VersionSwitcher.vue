<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from "vue";
import { useData, useRoute } from "vitepress";
import { versions } from "../versions";

const { site } = useData();
const route = useRoute();
const open = ref(false);

const currentVersion = computed(() => {
  const b = site.value.base;
  const match = b.match(/(\/v[\d.]+\/)?$/);
  return match?.[0] || "/";
});

const repoPrefix = computed(() => {
  const b = site.value.base;
  return b.replace(/(\/v[\d.]+\/)?$/, "");
});

const currentLabel = computed(() => {
  return (
    versions.find((v) => v.path === currentVersion.value)?.label ||
    versions[0]?.label ||
    ""
  );
});

const hasMultipleVersions = computed(() => versions.length > 1);

function isActive(v: (typeof versions)[number]) {
  return currentVersion.value === v.path;
}

function switchVersion(targetVerPath: string) {
  if (!hasMultipleVersions.value) return;

  const page = route.path;
  const url = repoPrefix.value + targetVerPath + page.replace(/^\//, "");
  window.location.href = url || "/";
  open.value = false;
}

function toggle(e: MouseEvent) {
  e.stopPropagation();
  if (!hasMultipleVersions.value) return;
  open.value = !open.value;
}

function onClickOutside() {
  open.value = false;
}

onMounted(() => {
  if (typeof window !== "undefined") {
    window.addEventListener("click", onClickOutside);
  }
});

onUnmounted(() => {
  if (typeof window !== "undefined") {
    window.removeEventListener("click", onClickOutside);
  }
});
</script>

<template>
  <div class="version-switcher" @click.stop>
    <button
      type="button"
      class="version-trigger"
      :class="{ disabled: !hasMultipleVersions }"
      :aria-expanded="open"
      :aria-haspopup="hasMultipleVersions"
      @click="toggle"
    >
      <span class="version-badge">{{ currentLabel }}</span>
      <svg
        v-if="hasMultipleVersions"
        class="version-arrow"
        :class="{ open }"
        viewBox="0 0 24 24"
        fill="none"
        width="14"
        height="14"
      >
        <path
          d="M7 10l5 5 5-5"
          stroke="currentColor"
          stroke-width="2"
          stroke-linecap="round"
        />
      </svg>
    </button>
    <div v-if="open && hasMultipleVersions" class="version-dropdown">
      <div
        v-for="v in versions"
        :key="v.path"
        class="version-option"
        :class="{ active: isActive(v) }"
        @click="switchVersion(v.path)"
      >
        <span class="version-label">{{ v.label }}</span>
        <span v-if="isActive(v)" class="check">✓</span>
      </div>
    </div>
  </div>
</template>

<style scoped>
.version-switcher {
  position: relative;
  display: flex;
  align-items: center;
  margin-left: 4px;
}

.version-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 12px;
  height: 36px;
  border: none;
  background: transparent;
  cursor: pointer;
  color: var(--vp-c-text-1);
  font-size: 13px;
  border-radius: 8px;
  transition: background 0.2s;
  font-family: inherit;
}

.version-trigger:hover {
  background: var(--vp-c-bg-soft);
}

.version-trigger.disabled {
  cursor: default;
}

.version-trigger.disabled:hover {
  background: transparent;
}

.version-badge {
  font-size: 13px;
  font-weight: 600;
  border: 1px solid var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  padding: 2px 10px;
  border-radius: 12px;
  transition: background 0.2s;
  line-height: 1;
}

.version-trigger:hover .version-badge {
  background: var(--vp-c-brand-soft);
}

.version-arrow {
  color: var(--vp-c-text-2);
  transition: transform 0.2s;
  flex-shrink: 0;
}

.version-arrow.open {
  transform: rotate(180deg);
}

.version-dropdown {
  position: absolute;
  top: calc(100% + 8px);
  right: 0;
  min-width: 140px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
  padding: 4px;
  z-index: 999;
}

.version-option {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 12px;
  cursor: pointer;
  font-size: 13px;
  white-space: nowrap;
  color: var(--vp-c-text-1);
  border-radius: 6px;
  transition: background 0.15s, color 0.15s;
  line-height: 1.5;
}

.version-option:hover {
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-brand-1);
}

.version-option.active {
  color: var(--vp-c-brand-1);
}

.version-label {
  flex: 1;
}

.check {
  margin-left: 8px;
  font-weight: bold;
}
</style>
