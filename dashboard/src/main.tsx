import React from "react";
import ReactDOM from "react-dom/client";
import "./styles/global.css";
import App from "./App";

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  constructor(props: any) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", height:"100vh", background:"#020617", color:"#f8fafc", fontFamily:"monospace", padding:32, gap:16 }}>
          <div style={{ fontSize:40 }}>💥</div>
          <div style={{ fontSize:18, fontWeight:700, color:"#ef4444" }}>Render Error</div>
          <pre style={{ background:"#0f172a", padding:20, borderRadius:10, fontSize:12, color:"#fca5a5", maxWidth:700, whiteSpace:"pre-wrap", border:"1px solid #334155" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack?.slice(0, 800)}
          </pre>
          <button onClick={() => { this.setState({ error: null }); window.location.reload(); }}
            style={{ padding:"10px 24px", background:"#2563eb", border:"none", borderRadius:8, color:"#fff", cursor:"pointer", fontSize:14 }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// StrictMode removed: causes Leaflet "Map container already initialized"
// due to deliberate double-mount in dev. ErrorBoundary still catches all errors.
ReactDOM.createRoot(document.getElementById("root")!).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>
);
