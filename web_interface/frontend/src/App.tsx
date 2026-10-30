import React from 'react';
import LoginGate, { useOperator } from './components/LoginGate';
import CommandCenter from './command/CommandCenter';
import './App.css';

// One page: the Command Center. (The hackathon dispatch dashboard and the old /dev, /telemetry
// and /map pages were removed; dispatch is a job in the Command Center now.)
const Main: React.FC = () => <CommandCenter operator={useOperator()} />;

const App: React.FC = () => (
  <LoginGate>
    <Main />
  </LoginGate>
);

export default App;
