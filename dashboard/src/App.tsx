import { useEffect } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { useAuth } from './auth/AuthProvider.tsx';
import { isOnboarded } from './auth/onboarding.ts';
import { Assistant } from './components/Assistant.tsx';
import { DeadlineNotifier } from './components/DeadlineNotifier.tsx';
import { MenuBarBridge } from './components/MenuBarBridge.tsx';
import { Dock } from './components/Dock.tsx';
import { Spotlight } from './components/Spotlight.tsx';
import './styles/assistant.css';
import './styles/spotlight.css';
import { Agents } from './pages/Agents.tsx';
import { savedPageTarget } from './lib/portal/list.ts';
import { Applications } from './pages/Applications.tsx';
import { ApplicationPortal } from './pages/ApplicationPortal.tsx';
import { ApplicationView } from './pages/ApplicationView.tsx';
import { Calendar } from './pages/Calendar.tsx';
import { Discover } from './pages/Discover.tsx';
import { Feed } from './pages/Feed.tsx';
import { ForgotPassword } from './pages/ForgotPassword.tsx';
import { Profile } from './pages/Profile.tsx';
import { Roadmap } from './pages/Roadmap.tsx';
import { RoadmapList } from './pages/RoadmapList.tsx';
import { Search } from './pages/Search.tsx';
import { Settings } from './pages/Settings.tsx';
import { SignIn } from './pages/SignIn.tsx';
import { SignUp } from './pages/SignUp.tsx';
import { Today } from './pages/Today.tsx';

/** The old Saved page's address, sent to the Saved stage of Applications (or its Sheet view). */
export function SavedRedirect() {
  const { search } = useLocation();
  return <Navigate to={savedPageTarget(search)} replace />;
}

/** Pages for getting into an account. They have no sidebar and need no sign-in. */
const accountPages = ['/signin', '/signup', '/forgot-password'];

export function App() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  const { status, user, continueAsGuest, signInEnabled } = useAuth();
  const onAccountPage = accountPages.includes(pathname);
  // When this backend has sign-in turned off, a signed-out visitor goes straight in as a guest so
  // the local user can use the app. The account pages stay reachable.
  const enterAsGuest = signInEnabled === false && status === 'signedOut' && !onAccountPage;
  useEffect(() => {
    if (enterAsGuest) continueAsGuest();
  }, [enterAsGuest, continueAsGuest]);
  // Firebase takes a moment to restore a saved sign-in; show nothing rather than flash the wrong page.
  if (status === 'loading') return <div className="window-drag" aria-hidden="true" />;
  // Wait to learn whether sign-in is on before sending a signed-out visitor to the sign-in page.
  if (status === 'signedOut' && signInEnabled === null && !onAccountPage) return <div className="window-drag" aria-hidden="true" />;
  // The moment before the guest session starts.
  if (enterAsGuest) return <div className="window-drag" aria-hidden="true" />;
  // The app is for signed-in students, or a guest who chose to look around on sample data.
  if (status === 'signedOut' && !onAccountPage) return <Navigate to="/signin" replace />;
  // A new account fills in "about you" once before reaching the feed.
  if (status === 'signedIn' && user && !isOnboarded(user.uid) && pathname !== '/signup') return <Navigate to="/signup" replace />;

  return (
    <>
      <div className="window-drag" aria-hidden="true" />
      {/* On every page, the sign-in pages too, so signing out clears the menu bar menu. */}
      <MenuBarBridge />
      {!onAccountPage && <Dock />}
      <Routes>
        <Route path="/" element={<Feed />} />
        <Route path="/today" element={<Today />} />
        <Route path="/roadmap" element={<Roadmap />} />
        <Route path="/roadmap/list" element={<RoadmapList />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/applications" element={<Applications />} />
        <Route path="/applications/:id" element={<ApplicationPortal />} />
        <Route path="/applications/:id/view" element={<ApplicationView />} />
        <Route path="/calendar" element={<Calendar />} />
        {/* Saved is the first stage of Applications now; the old address lands there. */}
        <Route path="/saved" element={<SavedRedirect />} />
        <Route path="/agents" element={<Agents />} />
        <Route path="/search" element={<Search />} />
        <Route path="/profile" element={<Profile />} />
        <Route path="/settings" element={<Settings />} />
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/forgot-password" element={<ForgotPassword />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {!onAccountPage && <Assistant />}
      {!onAccountPage && <DeadlineNotifier />}
      {!onAccountPage && <Spotlight />}
    </>
  );
}
