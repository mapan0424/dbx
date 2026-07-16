<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Activity, AlertTriangle, Database, Loader2, RefreshCcw, Server } from "@lucide/vue";
import { useI18n } from "vue-i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ConnectionConfig } from "@/types/database";
import { useConnectionStore } from "@/stores/connectionStore";
import * as api from "@/lib/backend/api";
import {
  XUGU_CLUSTER_NODES_SQL,
  XUGU_RUN_INFO_SQL,
  XUGU_VERSION_SQL,
  xuguClusterNodeStateLabel,
  xuguClusterNodeTypeLabel,
  xuguClusterNodesFromResult,
  xuguRunInfoFromResult,
  xuguVersionFromResult,
  type XuguClusterNode,
  type XuguRunInfo,
} from "@/lib/database/xuguMonitor";

const props = defineProps<{ connection: ConnectionConfig }>();
const { t } = useI18n();
const connectionStore = useConnectionStore();

const version = ref("");
const nodes = ref<XuguClusterNode[]>([]);
const runInfo = ref<XuguRunInfo[]>([]);
const loading = ref(false);
const error = ref("");

const runInfoByNode = computed(() => new Map(runInfo.value.map((entry) => [entry.nodeId, entry])));
const totalTransactions = computed(() => runInfo.value.reduce((sum, entry) => sum + numeric(entry.activeTransactions), 0));
const totalLockWaits = computed(() => runInfo.value.reduce((sum, entry) => sum + numeric(entry.lockWaits), 0));
const onlineNodes = computed(() => nodes.value.filter((node) => xuguClusterNodeStateLabel(node.state) === "running").length);

function numeric(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function nodeStateClass(node: XuguClusterNode): string {
  const state = xuguClusterNodeStateLabel(node.state);
  if (state === "running") return "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300";
  if (state === "error" || state === "offline") return "border-destructive/30 bg-destructive/10 text-destructive";
  return "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300";
}

function nodeStateText(node: XuguClusterNode): string {
  return t(`xuguMonitor.nodeState.${xuguClusterNodeStateLabel(node.state)}`);
}

function nodeTypeText(node: XuguClusterNode): string {
  return t(`xuguMonitor.nodeType.${xuguClusterNodeTypeLabel(node.nodeType)}`);
}

function valueFor(nodeId: string, key: keyof XuguRunInfo): string {
  return runInfoByNode.value.get(nodeId)?.[key] || "—";
}

async function load() {
  if (props.connection.db_type !== "xugu") return;
  loading.value = true;
  error.value = "";
  try {
    await connectionStore.ensureConnected(props.connection.id);
    const [versionResult, nodeResult, runInfoResult] = await Promise.all([
      api.executeQuery(props.connection.id, "", XUGU_VERSION_SQL, undefined, undefined, { maxRows: 1 }),
      api.executeQuery(props.connection.id, "", XUGU_CLUSTER_NODES_SQL, undefined, undefined, { maxRows: 500 }),
      api.executeQuery(props.connection.id, "", XUGU_RUN_INFO_SQL, undefined, undefined, { maxRows: 500 }),
    ]);
    version.value = xuguVersionFromResult(versionResult);
    nodes.value = xuguClusterNodesFromResult(nodeResult);
    runInfo.value = xuguRunInfoFromResult(runInfoResult);
  } catch (cause: any) {
    error.value = cause?.message || String(cause);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex h-11 shrink-0 items-center gap-2 border-b bg-muted/20 px-3">
      <Server class="h-4 w-4 text-primary" />
      <div class="truncate text-sm font-semibold">{{ t("xuguMonitor.title") }}</div>
      <Badge variant="outline" class="h-5 rounded-md px-1.5 text-[11px]">{{ connection.name }}</Badge>
      <div class="ml-auto flex items-center gap-2">
        <span v-if="version" class="hidden text-xs text-muted-foreground sm:inline">{{ version }}</span>
        <Button variant="outline" size="sm" class="h-7 gap-1.5 px-2 text-xs" @click="load">
          <Loader2 v-if="loading" class="h-3.5 w-3.5 animate-spin" />
          <RefreshCcw v-else class="h-3.5 w-3.5" />
          {{ t("grid.refresh") }}
        </Button>
      </div>
    </div>

    <div v-if="connection.db_type !== 'xugu'" class="flex flex-1 items-center justify-center text-sm text-muted-foreground">{{ t("xuguMonitor.unsupported") }}</div>
    <div v-else-if="error" class="flex flex-1 items-center justify-center gap-2 px-6 text-center text-sm text-destructive">
      <AlertTriangle class="h-4 w-4 shrink-0" />
      {{ error }}
    </div>
    <div v-else class="min-h-0 flex-1 overflow-auto p-4">
      <div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div class="rounded-lg border bg-card p-3">
          <div class="text-xs text-muted-foreground">{{ t("xuguMonitor.version") }}</div>
          <div class="mt-2 truncate text-sm font-semibold">{{ version || "—" }}</div>
        </div>
        <div class="rounded-lg border bg-card p-3">
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground"><Server class="h-3.5 w-3.5" />{{ t("xuguMonitor.onlineNodes") }}</div>
          <div class="mt-2 text-xl font-semibold">{{ onlineNodes }}<span class="ml-1 text-xs font-normal text-muted-foreground">/ {{ nodes.length }}</span></div>
        </div>
        <div class="rounded-lg border bg-card p-3">
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground"><Activity class="h-3.5 w-3.5" />{{ t("xuguMonitor.activeTransactions") }}</div>
          <div class="mt-2 text-xl font-semibold">{{ totalTransactions }}</div>
        </div>
        <div class="rounded-lg border bg-card p-3">
          <div class="flex items-center gap-1.5 text-xs text-muted-foreground"><Database class="h-3.5 w-3.5" />{{ t("xuguMonitor.lockWaits") }}</div>
          <div class="mt-2 text-xl font-semibold">{{ totalLockWaits }}</div>
        </div>
      </div>

      <section class="mt-4 overflow-hidden rounded-lg border bg-card">
        <div class="flex items-center justify-between border-b px-3 py-2.5">
          <div class="text-sm font-semibold">{{ t("xuguMonitor.nodes") }}</div>
          <div class="text-xs text-muted-foreground">{{ t("xuguMonitor.readOnlyHint") }}</div>
        </div>
        <div class="overflow-auto">
          <table class="w-full min-w-[960px] text-left text-xs">
            <thead class="bg-muted/40 text-muted-foreground">
              <tr>
                <th class="px-3 py-2 font-medium">{{ t("xuguMonitor.node") }}</th>
                <th class="px-3 py-2 font-medium">{{ t("xuguMonitor.type") }}</th>
                <th class="px-3 py-2 font-medium">{{ t("xuguMonitor.state") }}</th>
                <th class="px-3 py-2 font-medium">{{ t("xuguMonitor.cpuLoad") }}</th>
                <th class="px-3 py-2 font-medium">{{ t("xuguMonitor.transactions") }}</th>
                <th class="px-3 py-2 font-medium">{{ t("xuguMonitor.lockWaits") }}</th>
                <th class="px-3 py-2 font-medium">{{ t("xuguMonitor.diskRead") }}</th>
                <th class="px-3 py-2 font-medium">{{ t("xuguMonitor.diskWrite") }}</th>
                <th class="px-3 py-2 font-medium">{{ t("xuguMonitor.bootTime") }}</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="node in nodes" :key="node.nodeId" class="border-t hover:bg-muted/30">
                <td class="px-3 py-2"><div class="font-medium">#{{ node.nodeId }} · {{ node.host }}:{{ node.port }}</div><div class="mt-0.5 text-[11px] text-muted-foreground">{{ t("xuguMonitor.rack", { rack: node.rackNo || "—" }) }} · {{ t("xuguMonitor.stores", { count: node.storeCount || "0" }) }}</div></td>
                <td class="px-3 py-2">{{ nodeTypeText(node) }}</td>
                <td class="px-3 py-2"><Badge variant="outline" class="h-5 rounded-full px-2 text-[10px]" :class="nodeStateClass(node)">{{ nodeStateText(node) }}</Badge></td>
                <td class="px-3 py-2">{{ node.cpuLoad || "—" }}</td>
                <td class="px-3 py-2">{{ valueFor(node.nodeId, "activeTransactions") }}</td>
                <td class="px-3 py-2">{{ valueFor(node.nodeId, "lockWaits") }}</td>
                <td class="px-3 py-2">{{ valueFor(node.nodeId, "diskReadBytes") }}</td>
                <td class="px-3 py-2">{{ valueFor(node.nodeId, "diskWriteBytes") }}</td>
                <td class="px-3 py-2 text-muted-foreground">{{ node.bootTime || "—" }}</td>
              </tr>
              <tr v-if="!loading && nodes.length === 0"><td colspan="9" class="px-3 py-10 text-center text-muted-foreground">{{ t("xuguMonitor.emptyNodes") }}</td></tr>
            </tbody>
          </table>
        </div>
      </section>
    </div>
  </div>
</template>
