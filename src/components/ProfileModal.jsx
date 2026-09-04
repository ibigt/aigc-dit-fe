import { Camera, Check, Mail, ShieldCheck, UserRound, X } from "lucide-react";
import { useState } from "react";
import { updateProfileRequest } from "../api/auth.js";

export function ProfileModal({ open, mode, user, onClose, onSave }) {
  const [name, setName] = useState(user.name);
  const [email, setEmail] = useState(user.email);
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <section className="profile-modal" role="dialog" aria-modal="true">
        <header>
          <div>
            <span className="modal-kicker">ACCOUNT</span>
            <h2>{mode === "profile" ? "个人信息" : "个人信息"}</h2>
          </div>
          <button className="modal-close" type="button" aria-label="关闭账户窗口" onClick={onClose}><X size={19} /></button>
        </header>
        <form onSubmit={async (e) => {
          e.preventDefault();
          const saved = await updateProfileRequest({ name, email });
          onSave({ ...user, ...saved, name: saved.name, email: saved.email });
        }}>
          <div className="profile-avatar">
            <span>{name.slice(0, 1)}</span>
            <button type="button" aria-label="更换头像"><Camera size={15} /></button>
          </div>
          <label><span><UserRound size={15} /> 姓名</span><input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label><span><Mail size={15} /> 邮箱</span><input type="email" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label><span><ShieldCheck size={15} /> 身份</span><input value={user.role} disabled /></label>
          <button className="button button--primary" type="submit"><Check size={16} /> 保存修改</button>
        </form>
      </section>
    </div>
  );
}
