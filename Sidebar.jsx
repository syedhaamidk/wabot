import { useState } from "react";

const icons = {
  compose: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/>
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>
    </svg>
  ),
  schedule: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
      <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
      <line x1="3" y1="10" x2="21" y2="10"/>
    </svg>
  ),
  messages: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
    </svg>
  ),
  trash: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
      <path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4h6v2"/>
    </svg>
  ),
  settings: (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  ),
  signout: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  ),
  sun: (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="5"/>
      <line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/>
      <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
      <line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/>
      <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
    </svg>
  ),
};

const navItems = [
  { id: "compose", icon: icons.compose, label: "Compose" },
  { id: "schedule", icon: icons.schedule, label: "Schedule" },
  { id: "messages", icon: icons.messages, label: "Messages" },
  { id: "trash", icon: icons.trash, label: "Trash" },
  { id: "settings", icon: icons.settings, label: "Settings" },
];

function Sidebar({ activeId = "schedule", onNavigate = () => {}, isConnected = false, onSignOut = () => {} }) {
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap');

        .sb { font-family:'DM Sans',sans-serif; width:56px; height:100vh; background:#0e1310; border-right:1px solid rgba(255,255,255,0.05); display:flex; flex-direction:column; align-items:center; padding:12px 0; box-sizing:border-box; position:relative; flex-shrink:0; }

        /* Logo */
        .sb-logo { width:36px; height:36px; background:#22c55e; border-radius:10px; display:flex; align-items:center; justify-content:center; margin-bottom:20px; flex-shrink:0; }

        /* Nav */
        .sb-nav { display:flex; flex-direction:column; align-items:center; gap:2px; flex:1; width:100%; padding:0 8px; box-sizing:border-box; }

        .sb-item { width:100%; height:38px; border-radius:10px; display:flex; align-items:center; justify-content:center; cursor:pointer; border:none; background:transparent; color:rgba(255,255,255,0.28); transition:all 0.15s; position:relative; flex-shrink:0; }
        .sb-item:hover { background:rgba(255,255,255,0.06); color:rgba(255,255,255,0.7); }
        .sb-item.active { background:rgba(34,197,94,0.12); color:#22c55e; }

        /* Tooltip */
        .sb-item::after { content:attr(data-label); position:absolute; left:calc(100% + 10px); background:#1a1f1a; color:rgba(255,255,255,0.8); font-size:11px; font-weight:500; padding:4px 8px; border-radius:6px; white-space:nowrap; pointer-events:none; opacity:0; transform:translateX(-4px); transition:all 0.15s; border:1px solid rgba(255,255,255,0.08); z-index:50; font-family:'DM Sans',sans-serif; }
        .sb-item:hover::after { opacity:1; transform:translateX(0); }

        /* Divider */
        .sb-divider { width:24px; height:1px; background:rgba(255,255,255,0.07); margin:6px 0; flex-shrink:0; }

        /* Bottom section */
        .sb-bottom { width:100%; padding:0 8px; box-sizing:border-box; display:flex; flex-direction:column; align-items:center; gap:2px; border-top:1px solid rgba(255,255,255,0.05); padding-top:10px; }

        /* Status dot */
        .sb-status-btn { width:100%; height:38px; border-radius:10px; display:flex; align-items:center; justify-content:center; background:transparent; border:none; cursor:default; position:relative; flex-shrink:0; }
        .sb-status-btn::after { content: attr(data-label); position:absolute; left:calc(100% + 10px); background:#1a1f1a; color:rgba(255,255,255,0.8); font-size:11px; font-weight:500; padding:4px 8px; border-radius:6px; white-space:nowrap; pointer-events:none; opacity:0; transform:translateX(-4px); transition:all 0.15s; border:1px solid rgba(255,255,255,0.08); z-index:50; font-family:'DM Sans',sans-serif; }
        .sb-status-btn:hover::after { opacity:1; transform:translateX(0); }

        .sb-dot-wrap { position:relative; width:10px; height:10px; }
        .sb-dot { width:10px; height:10px; border-radius:50%; background:#ef4444; }
        .sb-dot.connected { background:#22c55e; }
        .sb-ring { position:absolute; inset:-3px; border-radius:50%; border:2px solid #22c55e; opacity:0; }
        .sb-dot.connected ~ .sb-ring { animation:ping 1.4s ease-out infinite; }
        @keyframes ping { 0%{opacity:0.6;transform:scale(0.7)} 100%{opacity:0;transform:scale(1.9)} }

        /* Sign out */
        .sb-signout { width:100%; height:38px; border-radius:10px; display:flex; align-items:center; justify-content:center; background:transparent; border:none; color:rgba(255,255,255,0.25); cursor:pointer; transition:all 0.15s; position:relative; flex-shrink:0; }
        .sb-signout:hover { background:rgba(239,68,68,0.1); color:#ef4444; }
        .sb-signout::after { content:'Sign out'; position:absolute; left:calc(100% + 10px); background:#1a1f1a; color:rgba(255,255,255,0.8); font-size:11px; font-weight:500; padding:4px 8px; border-radius:6px; white-space:nowrap; pointer-events:none; opacity:0; transform:translateX(-4px); transition:all 0.15s; border:1px solid rgba(255,255,255,0.08); z-index:50; font-family:'DM Sans',sans-serif; }
        .sb-signout:hover::after { opacity:1; transform:translateX(0); }

        /* Confirm popover */
        .sb-confirm { position:fixed; bottom:70px; left:64px; background:#1a1f1a; border:1px solid rgba(239,68,68,0.25); border-radius:12px; padding:12px; box-shadow:0 8px 32px rgba(0,0,0,0.6); animation:fadeIn 0.15s ease-out; z-index:200; width:180px; }
        @keyframes fadeIn { from{opacity:0;transform:translateY(4px)} to{opacity:1;transform:translateY(0)} }
        .sb-confirm p { font-size:12px; color:rgba(255,255,255,0.55); margin:0 0 10px; line-height:1.4; font-family:'DM Sans',sans-serif; }
        .sb-confirm-btns { display:flex; gap:6px; }
        .sb-btn { flex:1; padding:6px 0; border-radius:8px; border:none; font-size:12px; font-weight:600; font-family:'DM Sans',sans-serif; cursor:pointer; transition:all 0.15s; }
        .sb-btn-cancel { background:rgba(255,255,255,0.07); color:rgba(255,255,255,0.5); }
        .sb-btn-cancel:hover { background:rgba(255,255,255,0.12); }
        .sb-btn-confirm { background:#ef4444; color:white; }
        .sb-btn-confirm:hover { background:#dc2626; }
      `}</style>

      <div className="sb">
        {/* Logo */}
        <div className="sb-logo">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white">
            <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/>
          </svg>
        </div>

        {/* Nav items */}
        <div className="sb-nav">
          {navItems.map((item) => (
            <button
              key={item.id}
              className={`sb-item ${activeId === item.id ? "active" : ""}`}
              data-label={item.label}
              onClick={() => onNavigate(item.id)}
            >
              {item.icon}
            </button>
          ))}
        </div>

        {/* Bottom */}
        <div className="sb-bottom">
          {/* Connection status dot */}
          <div
            className="sb-status-btn"
            data-label={isConnected ? "WhatsApp Connected" : "WhatsApp Disconnected"}
          >
            <div className="sb-dot-wrap">
              <div className={`sb-dot ${isConnected ? "connected" : ""}`} />
              <div className="sb-ring" />
            </div>
          </div>

          {/* Sign out */}
          <button className="sb-signout" onClick={() => setShowConfirm(true)}>
            {icons.signout}
          </button>
        </div>

        {/* Confirm popover */}
        {showConfirm && (
          <div className="sb-confirm">
            <p>Sign out of WABot?</p>
            <div className="sb-confirm-btns">
              <button className="sb-btn sb-btn-cancel" onClick={() => setShowConfirm(false)}>Cancel</button>
              <button className="sb-btn sb-btn-confirm" onClick={() => { setShowConfirm(false); onSignOut(); }}>Sign out</button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}

// Preview
export default function App() {
  const [active, setActive] = useState("schedule");
  const [connected, setConnected] = useState(false);

  return (
    <div style={{ display: "flex", height: "100vh", background: "#111" }}>
      <Sidebar
        activeId={active}
        onNavigate={setActive}
        isConnected={connected}
        onSignOut={() => alert("Signed out!")}
      />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 16 }}>
        <p style={{ color: "rgba(255,255,255,0.3)", fontSize: 13, fontFamily: "sans-serif" }}>Active: <b style={{color:"#22c55e"}}>{active}</b></p>
        <button
          onClick={() => setConnected(c => !c)}
          style={{ padding: "8px 20px", borderRadius: 8, border: "1px solid rgba(255,255,255,0.1)", background: "rgba(255,255,255,0.05)", color: "rgba(255,255,255,0.6)", fontSize: 12, cursor: "pointer", fontFamily: "sans-serif" }}
        >
          Toggle: {connected ? "Connected ✓" : "Disconnected ✗"}
        </button>
      </div>
    </div>
  );
}
