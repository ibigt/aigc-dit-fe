import { Check, ChevronRight, Coins, CreditCard, History, ReceiptText, ShieldCheck, Smartphone, X, Zap } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import { useEffect, useRef, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { createRechargeOrder, fetchCreditLedger, fetchCreditSummary, fetchRechargeOrder, mockPayRechargeOrder } from "../api/credits.js";
import { toLedgerRows, resolveLedgerPager } from "../lib/creditLedger.js";
import { formatDateTime } from "../lib/media.js";

const chargeOptions = [10, 50, 100, 200];

export function CreditsModal({ open, user, onClose, onPaid, recentTransactions = [] }) {
  const [tab, setTab] = useState("recharge");
  const [amount, setAmount] = useState(50);
  const [payment, setPayment] = useState("wechat");
  const [success, setSuccess] = useState(false);
  const [paying, setPaying] = useState(false);
  const [payError, setPayError] = useState("");
  const [order, setOrder] = useState(null);
  const [ledgerPage, setLedgerPage] = useState(1);
  const paymentRequestId = useRef(null);
  const orderPollRef = useRef(null);
  const summaryQuery = useQuery({
    queryKey: ["credits", "summary"],
    queryFn: fetchCreditSummary,
    enabled: open,
  });
  const ledgerQuery = useQuery({
    queryKey: ["credits", "ledger", ledgerPage],
    queryFn: () => fetchCreditLedger({ pageNum: ledgerPage }),
    placeholderData: keepPreviousData,
    enabled: open && tab === "history",
  });
  useEffect(() => {
    if (!open) {
      setSuccess(false);
      setPaying(false);
      setPayError("");
      setOrder(null);
      setLedgerPage(1);
      paymentRequestId.current = null;
      stopOrderPolling();
    }
  }, [open]);
  useEffect(() => () => stopOrderPolling(), []);
  if (!open) return null;

  async function pay() {
    setPaying(true);
    setPayError("");
    paymentRequestId.current ||= globalThis.crypto?.randomUUID?.() || `recharge-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    try {
      const created = await createRechargeOrder({ amountYuan: amount, payment, requestId: paymentRequestId.current });
      setOrder(created);
      startOrderPolling(created.orderNo);
    } catch (error) {
      setPayError(error?.message || "下单失败，请重试");
      paymentRequestId.current = null;
    } finally {
      setPaying(false);
    }
  }

  function startOrderPolling(orderNo) {
    stopOrderPolling();
    orderPollRef.current = window.setInterval(async () => {
      try {
        const latest = await fetchRechargeOrder(orderNo);
        setOrder(latest);
        if (latest.status === "PAID") {
          stopOrderPolling();
          markOrderPaid();
        }
      } catch {
        // 轮询失败忽略，下一轮重试
      }
    }, 2500);
  }

  function stopOrderPolling() {
    if (orderPollRef.current) {
      window.clearInterval(orderPollRef.current);
      orderPollRef.current = null;
    }
  }

  function markOrderPaid() {
    setSuccess(true);
    paymentRequestId.current = null;
    window.setTimeout(() => setSuccess(false), 1800);
    onPaid?.();
  }

  async function mockPay() {
    if (!order?.orderNo) return;
    try {
      const paid = await mockPayRechargeOrder(order.orderNo);
      setOrder(paid);
      if (paid.status === "PAID") {
        stopOrderPolling();
        markOrderPaid();
      }
    } catch (error) {
      setPayError(error?.message || "模拟支付失败");
    }
  }

  function closeOrder() {
    stopOrderPolling();
    setOrder(null);
    paymentRequestId.current = null;
    setPayError("");
  }

  const summary = summaryQuery.data || {};
  const ledger = toLedgerRows(ledgerQuery.data?.result, { formatTime: formatDateTime });
  const pager = resolveLedgerPager(ledgerQuery.data);
  const transactionItems = [...recentTransactions, ...ledger].filter((item, index, list) => list.findIndex((row) => row.id === item.id) === index);

  return <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><section className="credits-modal" role="dialog" aria-modal="true"><header><div><span className="modal-kicker">CREDITS CENTER</span><h2>积分中心</h2><p>当前余额 <strong>{user.credits}</strong> 积分</p></div><button className="modal-close" aria-label="关闭积分中心" onClick={onClose}><X size={19} /></button></header><div className="credits-tabs"><button className={tab === "recharge" ? "active" : ""} onClick={() => setTab("recharge")}><CreditCard size={16} /> 积分充值</button><button className={tab === "history" ? "active" : ""} onClick={() => setTab("history")}><History size={16} /> 积分明细</button></div>{tab === "recharge" ? (order ? <div className="recharge-qr"><div className="recharge-qr__code">{order.qrCode ? <QRCodeSVG value={order.qrCode} size={168} level="M" /> : null}</div><strong className="recharge-qr__amount">¥{order.amountYuan}.00 · {order.creditAmount} 积分</strong>{order.status === "PAID" ? <span className="recharge-qr__paid"><Check size={15} /> 支付成功，积分已到账</span> : <span className="recharge-qr__hint">请使用{order.payment === "alipay" ? "支付宝" : "微信"}扫码支付</span>}{order.status !== "PAID" && <><div className="recharge-qr__waiting">等待支付中…</div><div className="recharge-qr__dev"><button type="button" onClick={mockPay}>模拟支付成功（联调用）</button><button type="button" onClick={closeOrder}>取消订单</button></div></>}{order.status === "PAID" && <button type="button" className="recharge-qr__done" onClick={closeOrder}>完成</button>}</div> : <div className="recharge-panel"><div className="rate-banner"><Coins size={20} /><div><strong>1 元 = 10 积分</strong><small>充值积分即时到账，可用于全部生成服务</small></div><span>固定汇率</span></div><span className="form-section-title">选择充值金额</span><div className="charge-options">{chargeOptions.map((item) => <button key={item} className={amount === item ? "active" : ""} onClick={() => { setAmount(item); setPayError(""); paymentRequestId.current = null; }}><strong>¥{item}</strong><span>{item * 10} 积分</span>{amount === item && <Check size={14} />}</button>)}</div><span className="form-section-title">支付方式</span><div className="payment-methods"><button className={payment === "wechat" ? "active" : ""} onClick={() => { setPayment("wechat"); setPayError(""); paymentRequestId.current = null; }}><span className="pay-icon pay-icon--wechat"><Smartphone size={17} /></span><div><strong>微信支付</strong><small>使用微信扫码支付</small></div>{payment === "wechat" && <Check size={16} />}</button><button className={payment === "alipay" ? "active" : ""} onClick={() => { setPayment("alipay"); setPayError(""); paymentRequestId.current = null; }}><span className="pay-icon pay-icon--alipay"><Zap size={17} /></span><div><strong>支付宝</strong><small>使用支付宝安全支付</small></div>{payment === "alipay" && <Check size={16} />}</button></div><div className="recharge-total"><span>应付金额</span><strong>¥{amount}.00</strong></div>{payError && <div className="recharge-error" role="alert">{payError}</div>}<button className="button button--primary recharge-submit" disabled={paying} onClick={pay}>{success ? <><Check size={17} /> 充值成功，已到账</> : paying ? "支付处理中…" : <>确认支付 <ChevronRight size={17} /></>}</button><small className="secure-note"><ShieldCheck size={13} /> 支付由安全服务提供，演示环境不会产生真实扣款</small></div>) : <div className="transaction-panel"><div className="transaction-summary"><div><span>累计充值</span><strong>{summary.totalRecharge ?? 0}</strong></div><div><span>本月消耗</span><strong>{summary.monthSpent ?? 0}</strong></div><div><span>当前余额</span><strong>{summary.balance ?? user.credits}</strong></div></div><div className="transaction-list">{transactionItems.length === 0 ? <div className="transaction-empty">{ledgerQuery.isPending ? "明细加载中…" : "暂无积分明细"}</div> : transactionItems.map((item) => <article key={item.id}><span className={`transaction-icon transaction-icon--${item.type}`}>{item.type === "charge" ? <Coins size={16} /> : <ReceiptText size={16} />}</span><div><strong>{item.title}</strong><small>{item.time}</small></div><b className={item.value > 0 ? "positive" : ""}>{item.value > 0 ? "+" : ""}{item.value}</b><span className="transaction-balance"><small>结余</small><b>{item.balance ?? "--"}</b></span></article>)}{pager.pages > 1 && <div className="admin-pager transaction-pager"><button type="button" disabled={ledgerPage <= 1} onClick={() => setLedgerPage(ledgerPage - 1)}>上一页</button><span>第 {ledgerPage} / {pager.pages} 页 · 共 {pager.totalNum} 条</span><button type="button" disabled={ledgerPage >= pager.pages} onClick={() => setLedgerPage(ledgerPage + 1)}>下一页</button></div>}</div></div>}</section></div>;
}
