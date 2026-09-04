import { Check, ChevronRight, Coins, CreditCard, History, ReceiptText, ShieldCheck, Smartphone, X, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fetchCreditLedger, fetchCreditSummary } from "../api/credits.js";
import { formatDateTime } from "../lib/media.js";

const chargeOptions = [10, 50, 100, 200];

export function CreditsModal({ open, user, onClose, onRecharge, recentTransactions = [] }) {
  const [tab, setTab] = useState("recharge");
  const [amount, setAmount] = useState(50);
  const [payment, setPayment] = useState("wechat");
  const [success, setSuccess] = useState(false);
  const [paying, setPaying] = useState(false);
  const summaryQuery = useQuery({
    queryKey: ["credits", "summary"],
    queryFn: fetchCreditSummary,
    enabled: open,
  });
  const ledgerQuery = useQuery({
    queryKey: ["credits", "ledger"],
    queryFn: fetchCreditLedger,
    enabled: open && tab === "history",
  });
  useEffect(() => {
    if (!open) {
      setSuccess(false);
      setPaying(false);
    }
  }, [open]);
  if (!open) return null;

  async function pay() {
    setPaying(true);
    try {
      await onRecharge(amount, payment);
      setSuccess(true);
      window.setTimeout(() => setSuccess(false), 1800);
    } finally {
      setPaying(false);
    }
  }

  const summary = summaryQuery.data || {};
  const ledger = (ledgerQuery.data?.result || []).map((item) => ({
    id: item.id,
    title: item.title || item.remark,
    time: formatDateTime(item.createdAt),
    value: item.changeAmt,
    type: item.type || (item.changeAmt > 0 ? "charge" : "deduct"),
  }));
  const transactionItems = [...recentTransactions, ...ledger].filter((item, index, list) => list.findIndex((row) => row.id === item.id) === index);

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="credits-modal" role="dialog" aria-modal="true"><header><div><span className="modal-kicker">CREDITS CENTER</span><h2>积分中心</h2><p>当前余额 <strong>{user.credits}</strong> 积分</p></div><button className="modal-close" aria-label="关闭积分中心" onClick={onClose}><X size={19} /></button></header><div className="credits-tabs"><button className={tab === "recharge" ? "active" : ""} onClick={() => setTab("recharge")}><CreditCard size={16} /> 积分充值</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History size={16} /> 积分明细</button></div>{tab === "recharge" ? <div className="recharge-panel"><div className="rate-banner"><Coins size={20} /><div><strong>1 元 = 10 积分</strong><small>充值积分即时到账，可用于全部生成服务</small></div><span>固定汇率</span></div><span className="form-section-title">选择充值金额</span><div className="charge-options">{chargeOptions.map((item) => <button key={item} className={amount === item ? "active" : ""} onClick={() => setAmount(item)}><strong>¥{item}</strong><span>{item * 10} 积分</span>{amount === item && <Check size={14} />}</button>)}</div><span className="form-section-title">支付方式</span><div className="payment-methods"><button className={payment === "wechat" ? "active" : ""} onClick={() => setPayment("wechat")}><span className="pay-icon pay-icon--wechat"><Smartphone size={17} /></span><div><strong>微信支付</strong><small>使用微信扫码支付</small></div>{payment === "wechat" && <Check size={16} />}</button><button className={payment === "alipay" ? "active" : ""} onClick={() => setPayment("alipay")}><span className="pay-icon pay-icon--alipay"><Zap size={17} /></span><div><strong>支付宝</strong><small>使用支付宝安全支付</small></div>{payment === "alipay" && <Check size={16} />}</button></div><div className="recharge-total"><span>应付金额</span><strong>¥{amount}.00</strong></div><button className="button button--primary recharge-submit" disabled={paying} onClick={pay}>{success ? <><Check size={17} /> 充值成功，已到账</> : <>确认支付 <ChevronRight size={17} /></>}</button><small className="secure-note"><ShieldCheck size={13} /> 支付由安全服务提供，演示环境不会产生真实扣款</small></div> : <div className="transaction-panel"><div className="transaction-summary"><div><span>累计充值</span><strong>{summary.totalRecharge ?? 0}</strong></div><div><span>本月消耗</span><strong>{summary.monthSpent ?? 0}</strong></div><div><span>当前余额</span><strong>{summary.balance ?? user.credits}</strong></div></div><div className="transaction-list">{transactionItems.map((item) => <article key={item.id}><span className={`transaction-icon transaction-icon--${item.type}`}>{item.type === "charge" ? <Coins size={16} /> : <ReceiptText size={16} />}</span><div><strong>{item.title}</strong><small>{item.time}</small></div><b className={item.value > 0 ? "positive" : ""}>{item.value > 0 ? "+" : ""}{item.value}</b></article>)}</div></div>}</section></div>;
}
