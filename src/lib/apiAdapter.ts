export interface ApiAdapter {
  channels: {
    list(): Promise<Channel[]>;
    listPaginated(params: { page: number; pageSize: number }): Promise<PaginatedResult<Channel>>;
    create(params: CreateChannelParams): Promise<Channel>;
    update(params: UpdateChannelParams): Promise<Channel>;
    delete(id: string): Promise<void>;
    fetchModels(channelId: string): Promise<FetchModelsResult>;
    fetchModelsDirect(apiType: string, baseUrl: string, apiKey: string, verified?: boolean, upstreamHeaders?: string): Promise<FetchModelsResult>;
    probeUrl(url: string, apiType?: string, apiKey?: string): Promise<ProbeResult>;
    testChannel(channelId: string): Promise<TestChannelResult>;
    testChannelDirect(params: TestChannelDirectParams): Promise<TestChannelResult>;
    selectModels(channelId: string, modelNames: string[], availableModels: ModelInfo[], catalogMeta?: ModelCatalogMetaUpdate[]): Promise<void>;
        updateResponseMs(channelId: string, responseMs: string): Promise<void>;
    saveChannelWithModels(params: SaveChannelWithModelsParams): Promise<SaveChannelWithModelsResult>;
  };
  usage: {
    getLogs(filter: UsageLogFilter): Promise<PaginatedResult<UsageLog>>;
    getDashboardStats(filter?: DashboardFilter): Promise<DashboardStats>;
    getModelConsumption(filter?: DashboardFilter): Promise<ChartDataPoint[]>;
    getCallTrend(filter?: DashboardFilter): Promise<ChartDataPoint[]>;
    getModelDistribution(filter?: DashboardFilter): Promise<ModelRanking[]>;
    getUserTrend(filter?: DashboardFilter): Promise<ChartDataPoint[]>;
    clearLogDetails(): Promise<number>;
  };
  pool: {
    list(): Promise<ApiEntry[]>;
    listPaginated(params: { page: number; pageSize: number; groupName?: string; search?: string; channelId?: string }): Promise<PaginatedResult<ApiEntry>>;
    toggle(id: string, enabled: boolean, options?: { pinToTop?: boolean }): Promise<void>;
    batchToggle(ids: string[], enabled: boolean): Promise<void>;
    reorder(orderedIds: string[]): Promise<void>;
    create(params: { channelId: string; model: string; displayName?: string; groupName?: string }): Promise<ApiEntry>;
    delete(id: string): Promise<void>;
    testLatency(id: string, modelScore?: number): Promise<{ entry_id: string; latency_ms: number | null; score: number; error_detail?: string }>;
    backfillCatalogMeta(items: { entryId: string; catalogProvider: string; catalogModelId: string }[]): Promise<void>;
    getGroups(): Promise<string[]>;
    updateDisplayName(id: string, displayName: string): Promise<void>;
    updateGroup(id: string, groupName: string): Promise<void>;
  };
  tokens: {
    list(): Promise<AccessKey[]>;
    listPaginated(params: { page: number; pageSize: number }): Promise<PaginatedResult<AccessKey>>;
    create(name: string): Promise<AccessKey>;
    delete(id: string): Promise<void>;
    toggle(id: string, enabled: boolean): Promise<void>;
  };
  connectionApps: {
    list(): Promise<ConnectionAppItem[]>;
    execute(id: string): Promise<AppConfigResult>;
  };
  importExport: {
    exportChannelModel(): Promise<string>;
    previewChannelModel(payload: string): Promise<ChannelModelImportPreview>;
    importChannelModel(payload: string): Promise<ChannelModelImportResult>;
  };
settings: {
    get(): Promise<AppSettings>;
    update(settings: AppSettings): Promise<void>;
    patchSettings(patch: Partial<AppSettings>): Promise<AppSettings>;
};
  proxy: {
    getStatus(): Promise<ProxyStatus>;
    start(): Promise<ProxyStatus>;
    stop(): Promise<void>;
  };
  testChat(entryId: string, messages: { role: string; content: string }[]): Promise<TestChatResponse>;
  translation: {
    getLatest(): Promise<TranslationRelayPayload | null>;
    translateAndRelay(request: TranslationRelayRequest): Promise<TranslationRelayPayload>;
  };
  getVersion(): Promise<{ version: string }>;
  getAdminStatus(): Promise<AdminStatus>;
  getPlatformCapabilities(): Promise<PlatformCapabilities>;
  getStateVersion(): Promise<{ log: number; pool: number; channel: number; token: number }>;
  dirty: {
    /**
     * Dirty flag check. Module can be one of: 'log' | 'pool' | 'channel' | 'token'
     * Returns true if the corresponding module has changed and a query refresh is required.
     */
    take(module: 'log' | 'pool' | 'channel' | 'token'): Promise<boolean>;
  };
}



import type { Channel, CreateChannelParams, UpdateChannelParams, FetchModelsResult, ProbeResult, TestChannelResult, TestChannelDirectParams, ModelInfo, ModelCatalogMetaUpdate, SaveChannelWithModelsParams, SaveChannelWithModelsResult } from '../features/channels/types';
import type { DashboardFilter, DashboardStats, ChartDataPoint, ModelRanking, UsageLog, UsageLogFilter, PaginatedResult, ApiEntry, AccessKey, AppSettings, ProxyStatus, AdminStatus, PlatformCapabilities, TestChatResponse, TranslationRelayPayload, TranslationRelayRequest, ConnectionAppItem, AppConfigResult, ChannelModelImportPreview, ChannelModelImportResult } from '../types';



