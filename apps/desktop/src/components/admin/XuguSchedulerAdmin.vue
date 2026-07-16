<script setup lang="ts">
import { computed, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { AlertTriangle, CalendarClock, Loader2, Play, Plus, Power, RefreshCcw, Trash2 } from "@lucide/vue";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useToast } from "@/composables/useToast";
import * as api from "@/lib/backend/api";
import { executeWithProductionSqlGuard } from "@/lib/database/productionExecutionGuard";
import {
  parseXuguSchedulerJobs,
  queryResultToObjects,
  xuguCreateSchedulerJobSql,
  xuguDisableSchedulerJobSql,
  xuguDropSchedulerJobSql,
  xuguEnableSchedulerJobSql,
  xuguRunSchedulerJobSql,
  xuguSchedulerJobListSql,
  xuguSchedulerNextRunSql,
  type XuguSchedulerJob,
} from "@/lib/database/xuguScheduler";
import { useConnectionStore } from "@/stores/connectionStore";
import type { ConnectionConfig } from "@/types/database";

const props = defineProps<{ connection: ConnectionConfig }>();

const { t } = useI18n();
const { toast } = useToast();
const connectionStore = useConnectionStore();
const jobs = ref<XuguSchedulerJob[]>([]);
const selectedJobName = ref("");
const search = ref("");
const loading = ref(false);
const error = ref("");
const nextRun = ref("");
const previewOpen = ref(false);
const pendingSql = ref("");
const applying = ref(false);
const createOpen = ref(false);
const createName = ref("JOB_TEST");
const createType = ref<"stored_procedure" | "plsql_block">("stored_procedure");
const createAction = ref("");
const createArgumentCount = ref(0);
const createStartDate = ref("SYSDATE");
const createRepeatInterval = ref("FREQ=DAILY;INTERVAL=1;");
const createEndDate = ref("");
const createEnabled = ref(false);
const createAutoDrop = ref(true);
const createComments = ref("");
const createArgumentValues = ref("");

const supported = computed(() => props.connection.db_type === "xugu");
const executionDatabase = computed(() => props.connection.database || "SYSTEM");
const selectedJob = computed(() => jobs.value.find((job) => job.name === selectedJobName.value));
const filteredJobs = computed(() => {
  const query = search.value.trim().toLowerCase();
  if (!query) return jobs.value;
  return jobs.value.filter((job) => `${job.name} ${job.owner} ${job.type} ${job.action} ${job.comments}`.toLowerCase().includes(query));
});
const selectedProperties = computed(() => (selectedJob.value ? Object.entries(selectedJob.value.raw).filter(([key]) => !["JOB_ACTION"].includes(key.toUpperCase())) : []));
const canCreate = computed(() => !!createName.value.trim() && !!createAction.value.trim());

async function ensureConnection() {
  await connectionStore.ensureConnected(props.connection.id);
}

async function loadJobs() {
  if (!supported.value) return;
  loading.value = true;
  error.value = "";
  nextRun.value = "";
  try {
    await ensureConnection();
    const result = await api.executeQuery(props.connection.id, executionDatabase.value, xuguSchedulerJobListSql(executionDatabase.value), undefined, undefined, { maxRows: 5000 });
    jobs.value = parseXuguSchedulerJobs(result);
    if (!selectedJob.value) selectedJobName.value = jobs.value[0]?.name || "";
  } catch (e: any) {
    error.value = e?.message || String(e);
    jobs.value = [];
  } finally {
    loading.value = false;
  }
}

async function loadNextRun() {
  const job = selectedJob.value;
  nextRun.value = "";
  if (!job || !job.lastRunAt) return;
  try {
    const result = await api.executeQuery(props.connection.id, executionDatabase.value, xuguSchedulerNextRunSql(executionDatabase.value, job.name), undefined, undefined, { maxRows: 1 });
    const row = queryResultToObjects(result)[0];
    const value = row && Object.values(row)[0];
    nextRun.value = value == null ? "" : String(value);
  } catch {
    // A legacy server may not expose JOB_NEXT_RUNTIME for all job states.
  }
}

function previewSql(sql: string) {
  pendingSql.value = sql;
  previewOpen.value = true;
}

function previewCreate() {
  if (!canCreate.value) return;
  previewSql(
    xuguCreateSchedulerJobSql({
      name: createName.value,
      type: createType.value,
      action: createAction.value,
      argumentCount: createArgumentCount.value,
      argumentValues: createArgumentValues.value.split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
      startDate: createStartDate.value,
      repeatInterval: createRepeatInterval.value,
      endDate: createEndDate.value,
      enabled: createEnabled.value,
      autoDrop: createAutoDrop.value,
      comments: createComments.value,
    }),
  );
}

function previewToggleEnabled(enabled: boolean) {
  const job = selectedJob.value;
  if (job) previewSql(enabled ? xuguEnableSchedulerJobSql(job.name) : xuguDisableSchedulerJobSql(job.name));
}

function previewRun() {
  const job = selectedJob.value;
  if (job) previewSql(xuguRunSchedulerJobSql(job.name));
}

function previewDrop() {
  const job = selectedJob.value;
  if (job) previewSql(xuguDropSchedulerJobSql(job.name));
}

async function applyPendingSql() {
  if (!pendingSql.value.trim()) return;
  applying.value = true;
  try {
    await ensureConnection();
    const result = await executeWithProductionSqlGuard({
      connection: props.connection,
      database: executionDatabase.value,
      sql: pendingSql.value,
      source: t("production.sourceAdmin"),
      execute: () => api.executeMulti(props.connection.id, executionDatabase.value, pendingSql.value, undefined, undefined, { maxRows: 1000 }),
    });
    if (!result) return;
    previewOpen.value = false;
    createOpen.value = false;
    toast(t("xuguScheduler.applySuccess"), 2500);
    await loadJobs();
  } catch (e: any) {
    toast(t("xuguScheduler.applyFailed", { message: e?.message || String(e) }), 5000);
  } finally {
    applying.value = false;
  }
}

watch(selectedJobName, () => void loadNextRun());
onMounted(() => void loadJobs());
</script>

<template>
  <div class="flex h-full min-h-0 flex-col bg-background">
    <div class="flex h-12 shrink-0 items-center gap-2 border-b px-3">
      <CalendarClock class="h-4 w-4 text-primary" />
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-semibold">{{ t("xuguScheduler.title") }}</div>
        <div class="truncate text-[11px] text-muted-foreground">{{ connection.name }}</div>
      </div>
      <Button size="sm" variant="outline" class="h-8 gap-1.5" :disabled="loading" @click="loadJobs">
        <Loader2 v-if="loading" class="h-3.5 w-3.5 animate-spin" />
        <RefreshCcw v-else class="h-3.5 w-3.5" />
        {{ t("contextMenu.refreshChildren") }}
      </Button>
      <Button size="sm" class="h-8 gap-1.5" @click="createOpen = true">
        <Plus class="h-3.5 w-3.5" />
        {{ t("xuguScheduler.newJob") }}
      </Button>
    </div>

    <div v-if="!supported" class="m-4 rounded border border-dashed p-4 text-sm text-muted-foreground">{{ t("xuguScheduler.unsupported") }}</div>
    <div v-else class="grid min-h-0 flex-1 grid-cols-[300px_minmax(0,1fr)]">
      <aside class="flex min-h-0 flex-col border-r">
        <div class="border-b p-2"><Input v-model="search" class="h-8 text-xs" :placeholder="t('xuguScheduler.searchJob')" /></div>
        <div v-if="error" class="m-2 rounded border border-destructive/30 bg-destructive/5 p-2 text-xs text-destructive"><div class="mb-1 flex items-center gap-1 font-medium"><AlertTriangle class="h-3.5 w-3.5" />{{ t("xuguScheduler.loadFailed") }}</div><div class="break-all">{{ error }}</div></div>
        <div class="min-h-0 flex-1 overflow-auto p-2">
          <button v-for="job in filteredJobs" :key="job.id" type="button" class="mb-1 w-full rounded border px-2 py-2 text-left text-xs transition hover:bg-accent" :class="selectedJobName === job.name ? 'border-primary bg-primary/10' : 'border-transparent'" @click="selectedJobName = job.name">
            <div class="flex items-center gap-2"><span class="min-w-0 flex-1 truncate font-medium">{{ job.name }}</span><Badge v-if="job.state.toUpperCase() === 'RUNNING'" variant="outline" class="h-5 border-amber-500/50 px-1.5 text-[10px] text-amber-700 dark:text-amber-300">{{ t("xuguScheduler.running") }}</Badge><Badge :variant="job.enabled ? 'default' : 'secondary'" class="h-5 px-1.5 text-[10px]">{{ job.enabled ? t("xuguScheduler.enabled") : t("xuguScheduler.disabled") }}</Badge></div>
            <div class="mt-1 truncate text-[11px] text-muted-foreground">{{ job.owner || "-" }} · {{ job.type || "-" }}</div>
          </button>
          <div v-if="!loading && filteredJobs.length === 0" class="p-6 text-center text-xs text-muted-foreground">{{ t("xuguScheduler.emptyJobs") }}</div>
        </div>
      </aside>

      <main class="min-h-0 overflow-auto p-4">
        <div v-if="!selectedJob" class="flex h-full items-center justify-center text-sm text-muted-foreground">{{ t("xuguScheduler.selectJob") }}</div>
        <template v-else>
          <div class="mb-4 flex flex-wrap items-center gap-2 border-b pb-3">
            <div class="min-w-0 flex-1"><div class="truncate text-base font-semibold">{{ selectedJob.name }}</div><div class="mt-1 text-xs text-muted-foreground">{{ selectedJob.comments || t("xuguScheduler.noComments") }}</div></div>
            <Button size="sm" variant="outline" class="h-8 gap-1.5" @click="previewRun"><Play class="h-3.5 w-3.5" />{{ t("xuguScheduler.runNow") }}</Button>
            <Button size="sm" variant="outline" class="h-8 gap-1.5" @click="previewToggleEnabled(!selectedJob.enabled)"><Power class="h-3.5 w-3.5" />{{ selectedJob.enabled ? t("xuguScheduler.disable") : t("xuguScheduler.enable") }}</Button>
            <Button size="sm" variant="destructive" class="h-8 gap-1.5" @click="previewDrop"><Trash2 class="h-3.5 w-3.5" />{{ t("xuguScheduler.dropJob") }}</Button>
          </div>
          <div class="mb-4 grid gap-3 sm:grid-cols-3"><div class="rounded border p-3 text-xs"><div class="text-muted-foreground">{{ t("xuguScheduler.state") }}</div><div class="mt-1 font-medium">{{ selectedJob.state || "-" }}</div></div><div class="rounded border p-3 text-xs"><div class="text-muted-foreground">{{ t("xuguScheduler.lastRun") }}</div><div class="mt-1 font-medium">{{ selectedJob.lastRunAt || "-" }}</div></div><div class="rounded border p-3 text-xs"><div class="text-muted-foreground">{{ t("xuguScheduler.nextRun") }}</div><div class="mt-1 font-medium">{{ nextRun || "-" }}</div></div></div>
          <section class="mb-4"><h3 class="mb-2 text-sm font-medium">{{ t("xuguScheduler.action") }}</h3><pre class="max-h-72 overflow-auto rounded border bg-muted/30 p-3 text-xs whitespace-pre-wrap">{{ selectedJob.action || "-" }}</pre></section>
          <section><h3 class="mb-2 text-sm font-medium">{{ t("xuguScheduler.properties") }}</h3><table class="w-full text-xs"><tbody><tr v-for="[key, value] in selectedProperties" :key="key" class="border-b"><th class="w-48 px-2 py-2 text-left font-medium text-muted-foreground">{{ key }}</th><td class="max-w-0 px-2 py-2 break-all">{{ value == null || value === "" ? "-" : value }}</td></tr></tbody></table></section>
        </template>
      </main>
    </div>

    <Dialog v-model:open="createOpen"><DialogContent class="max-w-3xl"><DialogHeader><DialogTitle>{{ t("xuguScheduler.newJob") }}</DialogTitle></DialogHeader><div class="grid gap-3 text-xs"><div class="grid grid-cols-2 gap-3"><label class="grid gap-1"><span>{{ t("xuguScheduler.jobName") }}</span><Input v-model="createName" class="h-8 text-xs" /></label><label class="grid gap-1"><span>{{ t("xuguScheduler.jobType") }}</span><select v-model="createType" class="h-8 rounded-md border bg-background px-2 text-xs"><option value="stored_procedure">STORED_PROCEDURE</option><option value="plsql_block">PLSQL_BLOCK</option></select></label></div><label class="grid gap-1"><span>{{ t("xuguScheduler.action") }}</span><textarea v-model="createAction" class="min-h-28 rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring" /></label><div class="grid grid-cols-3 gap-3"><label class="grid gap-1"><span>{{ t("xuguScheduler.argumentCount") }}</span><Input v-model.number="createArgumentCount" type="number" min="0" max="100" class="h-8 text-xs" /></label><label class="grid gap-1"><span>{{ t("xuguScheduler.startDate") }}</span><Input v-model="createStartDate" class="h-8 text-xs" /></label><label class="grid gap-1"><span>{{ t("xuguScheduler.endDate") }}</span><Input v-model="createEndDate" class="h-8 text-xs" /></label></div><label class="grid gap-1"><span>{{ t("xuguScheduler.argumentValues") }}</span><textarea v-model="createArgumentValues" class="min-h-20 rounded-md border bg-background px-3 py-2 font-mono text-xs outline-none focus:ring-2 focus:ring-ring" :placeholder="t('xuguScheduler.argumentValuesHint')" /></label><label class="grid gap-1"><span>{{ t("xuguScheduler.repeatInterval") }}</span><Input v-model="createRepeatInterval" class="h-8 text-xs" /></label><label class="grid gap-1"><span>{{ t("xuguScheduler.comments") }}</span><Input v-model="createComments" class="h-8 text-xs" /></label><div class="flex gap-5"><label class="flex items-center gap-2"><input v-model="createEnabled" type="checkbox" /><span>{{ t("xuguScheduler.enabled") }}</span></label><label class="flex items-center gap-2"><input v-model="createAutoDrop" type="checkbox" /><span>{{ t("xuguScheduler.autoDrop") }}</span></label></div></div><DialogFooter><Button variant="outline" @click="createOpen = false">{{ t("common.cancel") }}</Button><Button :disabled="!canCreate" @click="previewCreate">{{ t("xuguScheduler.previewSql") }}</Button></DialogFooter></DialogContent></Dialog>
    <Dialog v-model:open="previewOpen"><DialogContent class="max-w-3xl"><DialogHeader><DialogTitle>{{ t("xuguScheduler.sqlPreview") }}</DialogTitle></DialogHeader><pre class="max-h-[50vh] overflow-auto rounded-md border bg-muted/30 p-3 text-xs"><code>{{ pendingSql }}</code></pre><DialogFooter><Button variant="outline" @click="previewOpen = false">{{ t("common.cancel") }}</Button><Button :disabled="applying" @click="applyPendingSql"><Loader2 v-if="applying" class="mr-1 h-3.5 w-3.5 animate-spin" />{{ t("xuguScheduler.applySql") }}</Button></DialogFooter></DialogContent></Dialog>
  </div>
</template>
