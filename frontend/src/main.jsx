import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';

// Pull the entire MUI icon library into the main bundle.
// Nothing uses `_AllIcons` directly, but the import keeps it in the chunk.
import * as _AllIcons from '@mui/icons-material';
// eslint-disable-next-line no-unused-expressions
_AllIcons;

import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
