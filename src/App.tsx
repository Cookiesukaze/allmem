import { useEffect } from "react";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import { DashboardPage } from "./pages/DashboardPage";
import { ProjectsPage } from "./pages/ProjectsPage";
import { ExperiencesPage } from "./pages/ExperiencesPage";
import { UserPage } from "./pages/UserPage";
import { SettingsPage } from "./pages/SettingsPage";
import { ChatPage } from "./pages/ChatPage";
import { useAppStore } from "./store";
import { initStorage } from "./core/storage";

function App() {
  const { activePage } = useAppStore();

  useEffect(() => {
    initStorage().catch(console.error);
  }, []);

  return (
    <div className="flex flex-col h-full min-h-screen bg-background">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-hidden">
          {activePage === "dashboard" && <DashboardPage />}
          {activePage === "projects" && <ProjectsPage />}
          {activePage === "experiences" && <ExperiencesPage />}
          {activePage === "chat" && <ChatPage />}
          {activePage === "user" && <UserPage />}
          {activePage === "settings" && <SettingsPage />}
        </main>
      </div>
    </div>
  );
}

export default App;
