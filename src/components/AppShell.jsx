import React, { useState } from 'react';
import LoginGate from './LoginGate.jsx';

export default function AppShell({ children }) {
  const [readyCorpus, setReadyCorpus] = useState('');

  if (!readyCorpus) {
    return <LoginGate onReady={setReadyCorpus} />;
  }

  // Once ready, render the rest of your app (passed as children)
  return (
    <div>
      {/* LoginGate stays mounted above (as header) because it returns the selector after login */}
      <LoginGate onReady={setReadyCorpus} />
      <div>{children}</div>
    </div>
  );
}
