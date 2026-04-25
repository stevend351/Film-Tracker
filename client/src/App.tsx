import { useEffect } from 'react';
import { Switch, Route, Router } from 'wouter';
import { useHashLocation } from 'wouter/use-hash-location';
import { queryClient } from './lib/queryClient';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { StoreProvider } from '@/store/store';
import { AuthProvider, useAuth } from '@/store/auth';
import { Layout } from '@/components/Layout';
import Inventory from '@/pages/Inventory';
import LogUsage from '@/pages/LogUsage';
import Receive from '@/pages/Receive';
import PlanWeek from '@/pages/PlanWeek';
import Transfer from '@/pages/Transfer';
import Photos from '@/pages/Photos';
import Reports from '@/pages/Reports';
import NotFound from '@/pages/not-found';
import Login from '@/pages/Login';

function AppRouter() {
  return (
    <Switch>
      <Route path="/" component={Inventory} />
      <Route path="/log/:rollId" component={LogUsage} />
      <Route path="/receive" component={Receive} />
      <Route path="/plan" component={PlanWeek} />
      <Route path="/transfer" component={Transfer} />
      <Route path="/photos" component={Photos} />
      <Route path="/reports" component={Reports} />
      <Route component={NotFound} />
    </Switch>
  );
}

function AuthGate() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  return (
    <StoreProvider>
      <Router hook={useHashLocation}>
        <Layout>
          <AppRouter />
        </Layout>
      </Router>
    </StoreProvider>
  );
}

function App() {
  // Force dark mode by default (kitchens are often dim).
  useEffect(() => {
    document.documentElement.classList.add('dark');
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <Toaster />
          <AuthGate />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
