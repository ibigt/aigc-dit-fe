import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Ban,
  Bot,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudCog,
  Cpu,
  Gauge,
  Grid2X2,
  KeyRound,
  LayoutDashboard,
  List,
  MoreHorizontal,
  Pencil,
  Play,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Trash2,
  Users,
  X,
} from "lucide-react";
import { useMemo, useState } from "react";
import {
  changeAdminModelEnabled,
  changeAdminUserStatus,
  createAdminModel,
  createAdminUser,
  deleteAdminModel,
  deleteAdminUser,
  fetchAdminModels,
  fetchAdminUsers,
  fetchDashboard,
  resetAdminUserPassword,
  updateAdminModel,
  updateAdminUser,
} from "../api/admin.js";

const adminMenus = [
  { id: "dashboard", label: "仪表盘", icon: LayoutDashboard },
  { id: "users", label: "用户管理", icon: Users },
  { id: "models", label: "模型管理", icon: Bot },
];

const categoryLabels = { image: "图像模型", video: "视频模型" };
const categoryTabs = [{ id: "all", label: "全部" }, { id: "video", label: "视频模型" }, { id: "image", label: "图像模型" }];
const providerOptions = ["全部来源", "ComfyUI", "RunningHub", "手动配置"];
const usageColors = ["#665cf1", "#33a474", "#e2943b", "#d76588", "#8b94a1"];

function formatInt(value) {
  return Number(value || 0).toLocaleString("zh-CN");
}

function formatChange(percent) {
  if (percent == null) return "较昨日 —";
  const sign = percent > 0 ? "+" : "";
  return `较昨日 ${sign}${Number(percent).toFixed(1)}%`;
}

function formatLastSeen(iso) {
  if (!iso) return "尚未活跃";
  const date = new Date(iso);
  const diff = Date.now() - date.getTime();
  if (Number.isNaN(diff)) return "尚未活跃";
  if (diff < 60_000) return "刚刚";
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)} 天前`;
  return date.toLocaleString("zh-CN", { hour12: false }).replaceAll("/", "-");
}

function errorMessage(error, fallback) {
  return error?.message || fallback;
}

function SectionHeading({ title, description, action }) {
  return <header className="admin-page-heading"><div><h1>{title}</h1><p>{description}</p></div>{action}</header>;
}

function MetricCard({ icon: Icon, label, value, change, tone }) {
  return <article className={`admin-metric admin-metric--${tone}`}><span><Icon size={19} /></span><div><small>{label}</small><strong>{value}</strong><em>{change}</em></div></article>;
}

function Dashboard() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["admin-dashboard", 14],
    queryFn: () => fetchDashboard(14),
  });
  const metrics = data?.metrics || {};
  const trend = data?.trend || [];
  const hours = data?.hourly || Array.from({ length: 24 }, () => 0);
  const usages = (data?.modelUsage || []).map((item, index) => ({
    ...item,
    color: usageColors[index % usageColors.length],
  }));
  const sources = data?.sources || [];
  const maxTrend = Math.max(1, ...trend.map((item) => item.count || 0));
  const maxHour = Math.max(1, ...hours);
  const peakHour = data?.peakHour;
  return <div className="admin-page">
    <SectionHeading title="仪表盘" description="查看平台运行、模型调用与用户活跃情况。" action={<button className="admin-date"><Clock3 size={15} /> 最近 {data?.periodDays || 14} 天</button>} />
    {error && <div className="admin-notice">{errorMessage(error, "仪表盘加载失败")}</div>}
    <div className="admin-metrics">
      <MetricCard icon={Activity} label="今日请求" value={isLoading ? "…" : formatInt(metrics.todayRequests)} change={formatChange(metrics.todayRequestsChange)} tone="violet" />
      <MetricCard icon={Users} label="活跃用户" value={isLoading ? "…" : formatInt(metrics.activeUsers)} change={`本周新增 ${formatInt(metrics.newUsersThisWeek)}`} tone="green" />
      <MetricCard icon={Bot} label="启用模型" value={isLoading ? "…" : formatInt(metrics.enabledModels)} change={`共 ${formatInt(metrics.totalModels)} 个模型`} tone="blue" />
      <MetricCard icon={CircleDollarSign} label="今日积分消耗" value={isLoading ? "…" : formatInt(metrics.todayCreditCost)} change="按任务 credit_cost 汇总" tone="amber" />
      <MetricCard icon={Gauge} label="请求成功率" value={isLoading ? "…" : `${Number(metrics.successRate || 0).toFixed(1)}%`} change={`平均响应 ${Number(metrics.avgDurationSeconds || 0).toFixed(1)}s`} tone="rose" />
    </div>
    <div className="admin-dashboard-grid">
      <article className="admin-card admin-card--trend">
        <header><div><strong>请求趋势</strong><small>近 {data?.periodDays || 14} 天模型调用量</small></div><span>总计 {formatInt(trend.reduce((sum, item) => sum + (item.count || 0), 0))} 次</span></header>
        <div className="trend-chart" role="img" aria-label="请求趋势图">{trend.map((item, index) => <div key={item.date || index}><i style={{ height: `${Math.round((item.count || 0) / maxTrend * 100)}%` }} /><span>{index % 2 ? "" : `${String(item.date || "").slice(8)}日`}</span></div>)}</div>
      </article>
      <article className="admin-card">
        <header><div><strong>模型使用分析</strong><small>按请求次数占比</small></div><MoreHorizontal size={17} /></header>
        <div className="analysis-list">{usages.length ? usages.map((item) => <div key={item.name}><span><i style={{ background: item.color }} />{item.name}</span><b>{item.percent}%</b><em><i style={{ width: `${item.percent * 2.8}%`, background: item.color }} /></em></div>) : <div className="admin-empty"><span>暂无任务数据</span></div>}</div>
      </article>
      <article className="admin-card">
        <header><div><strong>请求来源分析</strong><small>创作入口调用分布</small></div><ChevronRight size={17} /></header>
        <div className="source-list">{sources.length ? sources.map((item) => <div key={item.name}><span>{item.name}</span><b>{item.percent}%</b><em><i style={{ width: `${item.percent}%` }} /></em></div>) : <div className="admin-empty"><span>暂无任务数据</span></div>}</div>
      </article>
      <article className="admin-card admin-card--hours">
        <header><div><strong>时段分析</strong><small>24 小时请求密度</small></div><span className="peak-badge">{peakHour == null ? "暂无峰值" : `峰值 ${String(peakHour).padStart(2, "0")}:00`}</span></header>
        <div className="hour-chart" role="img" aria-label="二十四小时请求时段分析">{hours.map((value, index) => <div key={index} title={`${index}:00 · ${value} 次`}><i style={{ height: `${Math.max(8, Math.round(value / maxHour * 100))}%` }} /><span>{index % 3 === 0 ? `${String(index).padStart(2, "0")}:00` : ""}</span></div>)}</div>
      </article>
    </div>
  </div>;
}

function UserDialog({ user, onClose, onSave, saving }) {
  const [draft, setDraft] = useState(user || { name: "", account: "", role: "CREATOR", credits: 100, status: "ENABLED" });
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="model-dialog user-dialog" role="dialog" aria-modal="true" aria-labelledby="user-dialog-title">
      <header><div><span>账号资料</span><h2 id="user-dialog-title">{user ? "编辑用户" : "添加用户"}</h2><p>维护账号、角色、状态和积分余额。</p></div><button className="modal-close" aria-label="关闭用户表单" onClick={onClose}><X size={18} /></button></header>
      <form onSubmit={(event) => { event.preventDefault(); onSave({ ...draft, credits: Number(draft.credits) || 0 }); }}>
        <div className="model-form-grid">
          <label>姓名<input required value={draft.name || ""} onChange={(event) => update("name", event.target.value)} /></label>
          <label>登录账号<input required value={draft.account || ""} onChange={(event) => update("account", event.target.value)} placeholder="name@example.com" disabled={Boolean(user)} /></label>
          <label>角色<select value={draft.role || "CREATOR"} onChange={(event) => update("role", event.target.value)}><option value="ADMIN">平台管理员</option><option value="CREATOR">创作者</option></select></label>
          <label>账号状态<select value={draft.status || "ENABLED"} onChange={(event) => update("status", event.target.value)}><option value="ENABLED">正常</option><option value="DISABLED">已禁用</option></select></label>
          <label>积分余额<input type="number" min="0" value={draft.credits ?? 0} onChange={(event) => update("credits", event.target.value)} /></label>
          {!user && <label>初始密码<input type="password" value={draft.password || ""} onChange={(event) => update("password", event.target.value)} placeholder="留空则自动生成" /></label>}
        </div>
        <footer>
          <span><ShieldCheck size={14} /> 变更将写入服务端</span>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button className="button button--primary" type="submit" disabled={saving}><Check size={15} /> {saving ? "保存中…" : "保存用户"}</button>
          </div>
        </footer>
      </form>
    </section>
  </div>;
}

function UsersPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState(undefined);
  const [notice, setNotice] = useState("");
  const usersQuery = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => fetchAdminUsers({ pageSize: 100 }),
  });
  const users = usersQuery.data?.result || [];
  const visible = users.filter((user) => `${user.name}${user.account}${user.email || ""}`.toLowerCase().includes(query.toLowerCase()));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-users"] });
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  };

  const saveMutation = useMutation({
    mutationFn: (draft) => {
      const payload = {
        name: draft.name,
        account: draft.account,
        email: draft.account,
        role: draft.role,
        status: draft.status,
        creditBalance: Number(draft.credits) || 0,
        password: draft.password || undefined,
      };
      return draft.id ? updateAdminUser(draft.id, payload) : createAdminUser(payload);
    },
    onSuccess: (resp) => {
      invalidate();
      setEditing(undefined);
      const extra = resp?.temporaryPassword ? `，临时密码：${resp.temporaryPassword}` : "";
      setNotice(`已保存 ${resp?.name || "用户"} 的账号资料${extra}`);
    },
    onError: (error) => setNotice(errorMessage(error, "保存用户失败")),
  });

  const statusMutation = useMutation({
    mutationFn: (user) => changeAdminUserStatus(user.id, user.status === "ENABLED" ? "DISABLED" : "ENABLED"),
    onSuccess: (resp) => {
      invalidate();
      setNotice(`${resp.name} 已${resp.status === "ENABLED" ? "启用" : "禁用"}`);
    },
    onError: (error) => setNotice(errorMessage(error, "更新状态失败")),
  });

  const resetMutation = useMutation({
    mutationFn: (user) => resetAdminUserPassword(user.id).then((resp) => ({ user, resp })),
    onSuccess: ({ user, resp }) => setNotice(`${user.name} 的密码已重置，临时密码：${resp.temporaryPassword}`),
    onError: (error) => setNotice(errorMessage(error, "重置密码失败")),
  });

  const deleteMutation = useMutation({
    mutationFn: (user) => deleteAdminUser(user.id).then(() => user),
    onSuccess: (user) => {
      invalidate();
      setNotice(`已删除用户 ${user.name}`);
    },
    onError: (error) => setNotice(errorMessage(error, "删除用户失败")),
  });

  return <div className="admin-page">
    <SectionHeading title="用户管理" description="支持账号新增、编辑、查询、删除、启停与密码重置。" action={<button className="button button--primary" onClick={() => setEditing(null)}><Plus size={16} /> 添加用户</button>} />
    {notice && <div className="admin-notice"><Check size={15} />{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {usersQuery.error && <div className="admin-notice">{errorMessage(usersQuery.error, "用户列表加载失败")}</div>}
    <div className="admin-table-card">
      <div className="admin-table-toolbar">
        <label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索姓名或账号" /></label>
        <div><span>共 {visible.length} 位用户</span></div>
      </div>
      <div className="admin-table-scroll">
        <table>
          <thead><tr><th>用户</th><th>角色</th><th>积分余额</th><th>请求数</th><th>最后活跃</th><th>状态</th><th>操作</th></tr></thead>
          <tbody>{visible.map((user) => <tr key={user.id}>
            <td><span className="table-avatar">{(user.name || "?").slice(0, 1)}</span><span><strong>{user.name}</strong><small>{user.account}</small></span></td>
            <td>{user.roleLabel || user.role}</td>
            <td>{formatInt(user.credits)}</td>
            <td>{formatInt(user.requests)}</td>
            <td>{formatLastSeen(user.lastSeen)}</td>
            <td><span className={`status-chip ${user.status === "ENABLED" ? "active" : ""}`}>{user.statusLabel || (user.status === "ENABLED" ? "正常" : "已禁用")}</span></td>
            <td>
              <div className="table-actions">
                <button title="编辑" aria-label={`编辑用户：${user.name}`} onClick={() => setEditing(user)}><Pencil size={14} /></button>
                <button title="重置密码" aria-label={`重置密码：${user.name}`} onClick={() => resetMutation.mutate(user)}><KeyRound size={14} /></button>
                <button title={user.status === "ENABLED" ? "禁用" : "启用"} aria-label={`${user.status === "ENABLED" ? "禁用" : "启用"}用户：${user.name}`} onClick={() => statusMutation.mutate(user)}>{user.status === "ENABLED" ? <Ban size={14} /> : <Play size={14} />}</button>
                <button className="danger" title="删除" aria-label={`删除用户：${user.name}`} onClick={() => { if (window.confirm(`确定删除用户“${user.name}”吗？`)) deleteMutation.mutate(user); }}><Trash2 size={14} /></button>
              </div>
            </td>
          </tr>)}</tbody>
        </table>
      </div>
    </div>
    {editing !== undefined && <UserDialog user={editing} saving={saveMutation.isPending} onClose={() => setEditing(undefined)} onSave={(draft) => saveMutation.mutate(draft)} />}
  </div>;
}

function PriceEditor({ title, values, onChange }) {
  return <fieldset className="price-editor"><legend>{title}</legend>{["input", "output", "cache"].map((key) => <label key={key}>{key === "input" ? "输入" : key === "output" ? "输出" : "缓存命中"}<input value={values?.[key] || "0"} onChange={(event) => onChange(key, event.target.value)} /></label>)}</fieldset>;
}

function ModelDialog({ model, onClose, onSave, saving }) {
  const emptyPricing = { unit: "张", sale: { input: "0", output: "3 积分", cache: "0" }, cost: { input: "0", output: "¥0.20", cache: "0" } };
  const [draft, setDraft] = useState(model || { name: "", category: "image", provider: "ComfyUI", modelKey: "", endpoint: "http://127.0.0.1:8188", description: "", enabled: true, apiKey: "", concurrentLimit: 1, instanceType: "", proxy: "", pricing: emptyPricing, logo: "/model-logos/comfyui-color.svg" });
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const changeProvider = (provider) => setDraft((current) => ({ ...current, provider, endpoint: provider === "ComfyUI" ? "http://127.0.0.1:8188" : provider === "RunningHub" ? "https://www.runninghub.ai/api" : "/mock-api" }));
  const updatePrice = (side, key, value) => setDraft((current) => ({ ...current, pricing: { ...(current.pricing || emptyPricing), [side]: { ...(current.pricing?.[side] || emptyPricing[side]), [key]: value } } }));
  const providerCopy = draft.provider === "ComfyUI" ? "配置服务地址、API Key 与 API 格式工作流。" : draft.provider === "RunningHub" ? "配置独立 API Key、云端工作流标识与并发限制。" : "配置兼容 API 的 Base URL、模型标识与可选代理。";
  return <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="model-dialog model-dialog--wide" role="dialog" aria-modal="true" aria-labelledby="model-dialog-title">
      <header><div><span>模型接入</span><h2 id="model-dialog-title">{model ? "编辑模型" : "接入第三方模型"}</h2><p>{providerCopy}</p></div><button className="modal-close" aria-label="关闭配置" onClick={onClose}><X size={18} /></button></header>
      <form onSubmit={(event) => {
        event.preventDefault();
        onSave({
          ...draft,
          badge: categoryLabels[draft.category] ? (draft.category === "video" ? "视频" : "图像") : draft.badge,
          category: draft.category,
          enabled: draft.enabled !== false,
          pricing: draft.pricing || emptyPricing,
        });
      }}>
        <div className="model-form-grid">
          <label>名称<input required value={draft.name} onChange={(event) => update("name", event.target.value)} placeholder="例如：自有视频模型" /></label>
          <label>模型类型<select value={draft.category} onChange={(event) => update("category", event.target.value)}><option value="image">图像模型</option><option value="video">视频模型</option></select></label>
          <label>接入来源<select value={draft.provider} onChange={(event) => changeProvider(event.target.value)}><option>ComfyUI</option><option>RunningHub</option><option>手动配置</option></select></label>
          <label>{draft.provider === "RunningHub" ? "工作流 / 模型 ID" : draft.provider === "ComfyUI" ? "工作流文件 / 模型标识" : "模型标识"}<input required value={draft.modelKey} onChange={(event) => update("modelKey", event.target.value)} placeholder="model-id / workflow.json" /></label>
          <label className="model-form-wide">{draft.provider === "ComfyUI" ? "ComfyUI 服务地址" : draft.provider === "RunningHub" ? "RunningHub API 地址" : "Base URL"}<input required value={draft.endpoint || ""} onChange={(event) => update("endpoint", event.target.value)} /></label>
          <label className="model-form-wide">API Key<input type="password" value={draft.apiKey || ""} onChange={(event) => update("apiKey", event.target.value)} placeholder={draft.hasApiKey ? "已加密保存，留空则保持不变" : "明文仅提交一次，服务端加密落库"} /></label>
          {draft.provider === "RunningHub" && <><label>实例类型<input value={draft.instanceType || ""} onChange={(event) => update("instanceType", event.target.value)} placeholder="可选，如 48G" /></label><label>并发限制<input type="number" min="1" max="10" value={draft.concurrentLimit || 1} onChange={(event) => update("concurrentLimit", Number(event.target.value))} /></label></>}
          {draft.provider === "手动配置" && <label className="model-form-wide">代理地址<input value={draft.proxy || ""} onChange={(event) => update("proxy", event.target.value)} placeholder="可选，如 http://127.0.0.1:9090" /></label>}
          <label className="model-form-wide">能力说明<input value={draft.description || ""} onChange={(event) => update("description", event.target.value)} placeholder="简要说明适用场景" /></label>
          <label>计费单位<select value={draft.pricing?.unit || "次"} onChange={(event) => setDraft((current) => ({ ...current, pricing: { ...(current.pricing || emptyPricing), unit: event.target.value } }))}><option>次</option><option>张</option><option>秒</option><option>万字符</option></select></label>
          <div />
          <PriceEditor title="售价" values={draft.pricing?.sale || emptyPricing.sale} onChange={(key, value) => updatePrice("sale", key, value)} />
          <PriceEditor title="成本" values={draft.pricing?.cost || emptyPricing.cost} onChange={(key, value) => updatePrice("cost", key, value)} />
        </div>
        <footer>
          <span><ShieldCheck size={14} /> 密钥加密落库，不会回传到列表</span>
          <div>
            <button type="button" onClick={onClose}>取消</button>
            <button className="button button--primary" type="submit" disabled={saving}><Check size={15} /> {saving ? "保存中…" : "保存配置"}</button>
          </div>
        </footer>
      </form>
    </section>
  </div>;
}

function PriceCell({ title, pricing, side }) {
  const values = pricing?.[side] || {};
  return <div className={`price-cell price-cell--${side}`}><strong>{title} · {values.output || "0"}/{pricing?.unit || "次"}</strong><small>输入 {values.input || "0"} · 缓存 {values.cache || "0"}</small></div>;
}

function ModelCard({ model, onToggle, onEdit, onRemove }) {
  return <article className="model-card"><header><span className="model-logo"><img src={model.logo || "/model-logos/comfyui-color.svg"} alt="" /></span><div><strong>{model.name}</strong><small>{model.modelKey}</small></div><label className="toggle-switch"><input aria-label={`${model.name} 创作端可用`} type="checkbox" checked={model.enabled !== false} onChange={(event) => onToggle(event.target.checked)} /><span /></label></header><p>{model.description}</p><div className="model-card-meta"><span>{categoryLabels[model.category]}</span><span>{model.provider}</span><span><i />{model.hasApiKey ? "密钥已配置" : "未配置密钥"}</span></div><div className="model-card-pricing"><PriceCell title="售价" pricing={model.pricing} side="sale" /><PriceCell title="成本" pricing={model.pricing} side="cost" /></div><footer><span>同步至创作端</span><div><button aria-label={`编辑模型：${model.name}`} onClick={onEdit}><Pencil size={14} /> 编辑</button><button className="danger" aria-label={`删除模型：${model.name}`} onClick={onRemove}><Trash2 size={14} /></button></div></footer></article>;
}

function toModelPayload(draft) {
  return {
    name: draft.name,
    modelKey: draft.modelKey,
    provider: draft.provider,
    endpoint: draft.endpoint,
    apiKey: draft.apiKey || undefined,
    category: draft.category,
    capabilities: draft.capabilities,
    pricing: draft.pricing,
    enabled: draft.enabled !== false,
    description: draft.description,
    badge: draft.badge,
    logo: draft.logo,
    concurrentLimit: draft.concurrentLimit,
    instanceType: draft.instanceType,
    proxy: draft.proxy,
  };
}

function ModelsPage() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("全部来源");
  const [category, setCategory] = useState("all");
  const [view, setView] = useState("cards");
  const [editing, setEditing] = useState(undefined);
  const [notice, setNotice] = useState("");
  const modelsQuery = useQuery({ queryKey: ["admin-models"], queryFn: fetchAdminModels });
  const models = modelsQuery.data || [];
  const modelItems = models.filter((model) => model.category !== "tool");
  const visible = modelItems.filter((model) => (provider === "全部来源" || model.provider === provider) && (category === "all" || model.category === category) && `${model.name}${model.description}${model.modelKey}`.toLowerCase().includes(query.toLowerCase()));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-models"] });
    queryClient.invalidateQueries({ queryKey: ["public-models"] });
    queryClient.invalidateQueries({ queryKey: ["admin-dashboard"] });
  };

  const saveMutation = useMutation({
    mutationFn: (draft) => (draft.id ? updateAdminModel(draft.id, toModelPayload(draft)) : createAdminModel(toModelPayload(draft))),
    onSuccess: () => {
      invalidate();
      setEditing(undefined);
      setNotice("模型配置已保存");
    },
    onError: (error) => setNotice(errorMessage(error, "保存模型失败")),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }) => changeAdminModelEnabled(id, enabled),
    onSuccess: invalidate,
    onError: (error) => setNotice(errorMessage(error, "更新模型状态失败")),
  });

  const removeMutation = useMutation({
    mutationFn: (model) => deleteAdminModel(model.id),
    onSuccess: () => {
      invalidate();
      setNotice("已删除模型");
    },
    onError: (error) => setNotice(errorMessage(error, "删除模型失败")),
  });

  return <div className="admin-page">
    <SectionHeading title="模型管理" description="管理创作端可选模型、接入来源与销售/成本计价。" action={<button className="button button--primary" onClick={() => setEditing(null)}><Plus size={16} /> 接入模型</button>} />
    {notice && <div className="admin-notice"><Check size={15} />{notice}<button aria-label="关闭提示" onClick={() => setNotice("")}><X size={14} /></button></div>}
    {modelsQuery.error && <div className="admin-notice">{errorMessage(modelsQuery.error, "模型列表加载失败")}</div>}
    <div className="model-category-tabs" role="tablist" aria-label="模型类型">{categoryTabs.map((tab) => <button role="tab" aria-selected={category === tab.id} className={category === tab.id ? "active" : ""} key={tab.id} onClick={() => setCategory(tab.id)}>{tab.label}<span>{tab.id === "all" ? modelItems.length : modelItems.filter((item) => item.category === tab.id).length}</span></button>)}</div>
    <div className="model-summary"><span><Server size={17} /><b>{modelItems.filter((item) => item.provider === "ComfyUI").length}</b> ComfyUI</span><span><CloudCog size={17} /><b>{modelItems.filter((item) => item.provider === "RunningHub").length}</b> RunningHub</span><span><Cpu size={17} /><b>{modelItems.filter((item) => item.provider === "手动配置").length}</b> 手动配置</span><em>已启用 {modelItems.filter((item) => item.enabled !== false).length} / {modelItems.length}</em></div>
    <div className="model-toolbar"><label><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索模型名称或标识" /></label><select aria-label="筛选接入来源" value={provider} onChange={(event) => setProvider(event.target.value)}>{providerOptions.map((item) => <option key={item}>{item}</option>)}</select><div className="view-switch" role="group" aria-label="视图模式"><button className={view === "cards" ? "active" : ""} aria-label="卡片模式" onClick={() => setView("cards")}><Grid2X2 size={15} /></button><button className={view === "list" ? "active" : ""} aria-label="列表模式" onClick={() => setView("list")}><List size={15} /></button></div></div>
    {view === "cards" ? <div className="model-card-grid">{visible.map((model) => <ModelCard key={model.id} model={model} onToggle={(enabled) => toggleMutation.mutate({ id: model.id, enabled })} onEdit={() => setEditing({ ...model, apiKey: "" })} onRemove={() => { if (window.confirm(`确定删除模型“${model.name}”吗？`)) removeMutation.mutate(model); }} />)}</div> : <div className="admin-table-card model-table"><div className="admin-table-scroll"><table><thead><tr><th>模型</th><th>类型</th><th>接入来源</th><th>售价</th><th>成本</th><th>服务状态</th><th>创作端可用</th><th>操作</th></tr></thead><tbody>{visible.map((model) => <tr key={model.id}><td><span className="table-model-logo"><img src={model.logo || "/model-logos/comfyui-color.svg"} alt="" /></span><span><strong>{model.name}</strong><small>{model.modelKey}</small></span></td><td><span className="category-chip">{categoryLabels[model.category]}</span></td><td>{model.provider}</td><td><PriceCell title="售价" pricing={model.pricing} side="sale" /></td><td><PriceCell title="成本" pricing={model.pricing} side="cost" /></td><td><span className="service-ok"><i />{model.hasApiKey ? "密钥已配置" : "未配置密钥"}</span></td><td><label className="toggle-switch"><input aria-label={`${model.name} 创作端可用`} type="checkbox" checked={model.enabled !== false} onChange={(event) => toggleMutation.mutate({ id: model.id, enabled: event.target.checked })} /><span /></label></td><td><div className="table-actions"><button aria-label={`编辑模型：${model.name}`} onClick={() => setEditing({ ...model, apiKey: "" })}><Pencil size={14} /></button><button className="danger" aria-label={`删除模型：${model.name}`} onClick={() => { if (window.confirm(`确定删除模型“${model.name}”吗？`)) removeMutation.mutate(model); }}><Trash2 size={14} /></button></div></td></tr>)}</tbody></table></div></div>}
    {!visible.length && <div className="admin-empty"><Bot size={22} /><strong>没有匹配的模型</strong><span>接入模型或调整类型、来源、关键词后重试。</span></div>}
    {editing !== undefined && <ModelDialog model={editing} saving={saveMutation.isPending} onClose={() => setEditing(undefined)} onSave={(draft) => saveMutation.mutate(draft)} />}
  </div>;
}

export function AdminConsole() {
  const [active, setActive] = useState("dashboard");
  const current = useMemo(() => adminMenus.find((item) => item.id === active), [active]);
  return <div className="admin-shell"><aside className="admin-sidebar"><header><span><ShieldCheck size={17} /></span><div><strong>管理后台</strong><small>平台运营控制台</small></div></header><nav>{adminMenus.map((item) => { const Icon = item.icon; return <button key={item.id} className={active === item.id ? "active" : ""} onClick={() => setActive(item.id)}><Icon size={17} /><span>{item.label}</span><ChevronRight size={14} /></button>; })}</nav><footer><span><span className="status-dot" /> 服务运行正常</span><small>一期 · 仪表盘 / 用户 / 模型</small></footer></aside><section className="admin-main" aria-label={current?.label}>{active === "dashboard" && <Dashboard />}{active === "users" && <UsersPage />}{active === "models" && <ModelsPage />}</section></div>;
}
