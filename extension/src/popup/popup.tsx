import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './popup.css';

interface ServerInfo {
  token: string;
  projectPath: string;
  projectName: string;
  port: number;
  pid: number;
  startedAt: string;
}

function Popup() {
  const [isActive, setIsActive] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected' | 'error'>('disconnected');
  const [connectedProject, setConnectedProject] = useState<string | null>(null);
  const [availableServers, setAvailableServers] = useState<ServerInfo[]>([]);
  const [loading, setLoading] = useState(true);

  // Load initial state and fetch available servers
  useEffect(() => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response) {
        setIsActive(response.isActive || false);
        setConnectionStatus(response.connectionStatus || 'disconnected');
        setConnectedProject(response.connectedProject || null);
      }
    });

    fetchServers();
  }, []);

  // Fetch available servers from discovery endpoint
  const fetchServers = async () => {
    setLoading(true);
    try {
      const response = await fetch('http://localhost:3848/servers');
      if (response.ok) {
        const servers = await response.json();
        setAvailableServers(servers);
      }
    } catch (error) {
      // Discovery server not running, no servers available
      setAvailableServers([]);
    }
    setLoading(false);
  };

  // Toggle active state
  const handleToggle = async () => {
    const newState = !isActive;
    setIsActive(newState);

    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'SET_ACTIVE', active: newState });
    }

    chrome.runtime.sendMessage({ type: 'SET_ACTIVE', active: newState });
  };

  // Connect to a server
  const handleConnect = (server: ServerInfo) => {
    setConnectionStatus('connecting');
    chrome.runtime.sendMessage({
      type: 'CONNECT_MCP',
      token: server.token,
      projectName: server.projectName
    }, () => {
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
          if (response) {
            setConnectionStatus(response.connectionStatus || 'disconnected');
            setConnectedProject(response.connectedProject || server.projectName);
          }
        });
      }, 500);
    });
  };

  // Disconnect
  const handleDisconnect = () => {
    chrome.runtime.sendMessage({ type: 'DISCONNECT_MCP' }, () => {
      setConnectionStatus('disconnected');
      setConnectedProject(null);
      fetchServers();
    });
  };

  const statusColors: Record<string, string> = {
    disconnected: '#9ca3af',
    connecting: '#f59e0b',
    connected: '#22c55e',
    error: '#ef4444',
  };

  return (
    <div className="popup">
      <div className="popup-header">
        <h1>Visual Feedback</h1>
        <div
          className="status-dot"
          style={{ backgroundColor: statusColors[connectionStatus] }}
          title={connectionStatus}
        />
      </div>

      <div className="popup-content">
        {/* Active toggle */}
        <div className="toggle-row">
          <span>Enable on current page</span>
          <button
            className={`toggle-btn ${isActive ? 'active' : ''}`}
            onClick={handleToggle}
          >
            <span className="toggle-knob" />
          </button>
        </div>

        {/* Connection section */}
        <div className="status-section">
          {connectionStatus === 'connected' ? (
            <>
              <div className="connected-info">
                <span className="connected-label">Connected to:</span>
                <span className="connected-project">{connectedProject}</span>
              </div>
              <button className="disconnect-btn" onClick={handleDisconnect}>
                Disconnect
              </button>
            </>
          ) : (
            <>
              <div className="servers-header">
                <span>Available Claude Code instances:</span>
                <button className="refresh-btn" onClick={fetchServers} title="Refresh">
                  ↻
                </button>
              </div>

              {loading ? (
                <div className="loading">Searching...</div>
              ) : availableServers.length > 0 ? (
                <div className="server-list">
                  {availableServers.map((server) => (
                    <button
                      key={server.pid}
                      className="server-item"
                      onClick={() => handleConnect(server)}
                    >
                      <span className="server-name">{server.projectName}</span>
                      <span className="server-path">{server.projectPath}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="no-servers">
                  <p>No Claude Code instances found.</p>
                  <p className="hint">Start Claude Code in a project directory.</p>
                </div>
              )}
            </>
          )}
        </div>

        {/* Instructions */}
        <div className="instructions">
          <h3>How to use:</h3>
          <ol>
            <li>Connect to a Claude Code instance above</li>
            <li>Enable the toggle, then click elements</li>
            <li>Type feedback and click Confirm</li>
          </ol>
        </div>
      </div>

      <div className="popup-footer">
        <span>v0.1.0</span>
        <a href="https://github.com/coleschaffer/visual-feedback-tool" target="_blank" rel="noopener">
          GitHub
        </a>
      </div>
    </div>
  );
}

const container = document.getElementById('root');
if (container) {
  const root = createRoot(container);
  root.render(<Popup />);
}
