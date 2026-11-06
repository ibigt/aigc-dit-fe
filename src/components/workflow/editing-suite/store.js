import { useSyncExternalStore } from "react";
import { HISTORY_LIMIT } from "./model.js";

/**
 * 剪辑台独立 store（无新依赖，基于 React 19 的 useSyncExternalStore）。
 * - doc 是唯一进撤销栈的快照（timeline + selection）
 * - view 是视图态（面板/缩放/选中工具等），不入栈
 * - 播放头走 transient 通道：60fps 更新不触发 React 渲染
 * 与画布撤销栈物理隔离；唯一交叉点 = 导出成功写回节点时由画布侧 rememberGraph() 记一条。
 */
export function createEditingStore(initialTimeline) {
  let state = {
    doc: { timeline: initialTimeline, selection: [] },
    view: {
      panel: "media",
      rightTab: "props",
      pxPerSec: 40,
      zoomIndex: 2,
      snap: true,
      leftCollapsed: false,
      rightCollapsed: window.innerWidth < 1440,
      tool: "select",
      soloClipId: null,
      editClipId: null,
      toast: null,
      dialog: null,
      exporting: false,
      dirty: false,
    },
    past: [],
    future: [],
  };
  const listeners = new Set();
  const timeListeners = new Set();
  let time = 0;
  let toastTimer = 0;

  const notify = () => listeners.forEach((listener) => listener());
  const getState = () => state;
  const subscribe = (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  function setView(patch) {
    state = { ...state, view: { ...state.view, ...patch } };
    notify();
  }

  // 一次用户意图 = 一条历史；recipe 返回新的 doc，返回同一引用视为无改动
  function commit(label, recipe) {
    const before = state.doc;
    const next = recipe(before);
    if (!next || next === before) return false;
    state = {
      ...state,
      doc: next,
      past: [...state.past.slice(-(HISTORY_LIMIT - 1)), { doc: before, label }],
      future: [],
      view: { ...state.view, dirty: true },
    };
    notify();
    return true;
  }

  function undo() {
    const entry = state.past.at(-1);
    if (!entry) return false;
    state = {
      ...state,
      doc: entry.doc,
      past: state.past.slice(0, -1),
      future: [...state.future, { doc: state.doc, label: entry.label }],
      view: { ...state.view, dirty: true, toast: `已撤销：${entry.label}` },
    };
    notify();
    return true;
  }

  function redo() {
    const entry = state.future.at(-1);
    if (!entry) return false;
    state = {
      ...state,
      doc: entry.doc,
      past: [...state.past.slice(-(HISTORY_LIMIT - 1)), { doc: state.doc, label: entry.label }],
      future: state.future.slice(0, -1),
      view: { ...state.view, dirty: true, toast: `已重做：${entry.label}` },
    };
    notify();
    return true;
  }

  function select(ids) {
    state = { ...state, doc: { ...state.doc, selection: ids } };
    notify();
  }

  function toast(message, tone = "info") {
    window.clearTimeout(toastTimer);
    setView({ toast: { message, tone } });
    toastTimer = window.setTimeout(() => {
      state = { ...state, view: { ...state.view, toast: null } };
      notify();
    }, tone === "error" ? 6000 : 4000);
  }

  function setTime(value) {
    time = Math.max(0, Number(value) || 0);
    timeListeners.forEach((listener) => listener(time));
  }
  const subscribeTime = (listener) => {
    timeListeners.add(listener);
    listener(time);
    return () => timeListeners.delete(listener);
  };
  const getTime = () => time;

  return {
    getState, subscribe, setView, commit, undo, redo, select, toast,
    setTime, subscribeTime, getTime,
    canUndo: () => state.past.length > 0,
    canRedo: () => state.future.length > 0,
    markClean: () => setView({ dirty: false }),
  };
}

export function useEditingStore(store) {
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
