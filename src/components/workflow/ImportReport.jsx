import { X } from "lucide-react";

// 导入结果浮层（需求 4.4.2.4）：逐项展示错误清单与兼容警告，画布层与模板层共用
export function ImportReport({ report, onClose }) {
  if (!report) return null;
  const errors = report.errors || [];
  const warnings = report.warnings || [];
  return <div className="import-report" role="dialog" aria-modal="true" aria-label="导入结果">
    <header><div><strong>{errors.length ? "导入失败，画布未改动" : "导入完成，存在兼容提示"}</strong><small>{report.fileName}</small></div><button aria-label="关闭导入结果" onClick={onClose}><X size={15} /></button></header>
    <div className="import-report__body">
      {errors.length > 0 && <section><h4>错误清单</h4><ul>{errors.map((message) => <li key={message}>{message}</li>)}</ul></section>}
      {warnings.length > 0 && <section><h4>兼容警告</h4><ul>{warnings.map((message) => <li key={message}>{message}</li>)}</ul></section>}
    </div>
    <footer><button onClick={onClose}>知道了</button></footer>
  </div>;
}
