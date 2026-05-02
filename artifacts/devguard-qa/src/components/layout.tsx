import { Link, useLocation } from "wouter";
import { Shield, History, BarChart3, Moon, Sun } from "lucide-react";
import { useTheme } from "./theme-provider";
import { Button } from "./ui/button";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { theme, setTheme } = useTheme();

  return (
    <div className="min-h-screen bg-background flex flex-col md:flex-row w-full selection:bg-primary/30">
      <aside className="w-full md:w-64 border-b md:border-r border-border bg-card/50 backdrop-blur flex flex-col z-10 shrink-0">
        <div className="p-6 border-b border-border flex items-center gap-3">
          <div className="w-8 h-8 rounded bg-primary flex items-center justify-center text-primary-foreground shadow-lg shadow-primary/20">
            <Shield size={18} strokeWidth={2.5} />
          </div>
          <span className="font-bold text-lg tracking-tight">DevGuard QA</span>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 flex flex-row md:flex-col overflow-x-auto md:overflow-visible">
          <Link href="/" className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors whitespace-nowrap ${location === '/' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <Shield size={18} />
            <span>Workspace</span>
          </Link>
          <Link href="/history" className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors whitespace-nowrap ${location === '/history' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <History size={18} />
            <span>History</span>
          </Link>
          <Link href="/stats" className={`flex items-center gap-3 px-3 py-2.5 rounded-md transition-colors whitespace-nowrap ${location === '/stats' ? 'bg-primary/10 text-primary font-medium' : 'text-muted-foreground hover:bg-secondary hover:text-foreground'}`}>
            <BarChart3 size={18} />
            <span>Statistics</span>
          </Link>
        </nav>
        
        <div className="p-4 border-t border-border mt-auto hidden md:block">
          <Button 
            variant="ghost" 
            className="w-full justify-start gap-3" 
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
            <span>{theme === "dark" ? "Light Mode" : "Dark Mode"}</span>
          </Button>
        </div>
      </aside>
      
      <main className="flex-1 flex flex-col overflow-hidden max-h-[100dvh]">
        {children}
      </main>
    </div>
  );
}
