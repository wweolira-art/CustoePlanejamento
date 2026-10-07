import { Component, StrictMode, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { AppProvider } from "./store";
import "./index.css";

const saved = localStorage.getItem("theme");
document.documentElement.dataset.theme = saved === "dark" ? "dark" : "light";

class RootError extends Component<{ children: ReactNode }, { message: string | null }> {
  state = { message: null as string | null };

  static getDerivedStateFromError(error: Error) {
    return { message: error.message || "Erro ao abrir o sistema." };
  }

  render() {
    if (this.state.message) {
      return (
        <div className="boot">
          <div>
            <h1>A tela não carregou</h1>
            <p>{this.state.message}</p>
            <p>
              Recarregue com Ctrl+F5. Se continuar, avise qual item do menu você abriu.
            </p>
            <button className="btn" onClick={() => location.reload()}>
              Recarregar
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <RootError>
      <AppProvider>
        <App />
      </AppProvider>
    </RootError>
  </StrictMode>,
);
