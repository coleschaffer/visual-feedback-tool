import { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import './popup.css';

interface Task {
  id: string;
  feedback: string;
  element: {
    tag: string;
    classes: string[];
    selector?: string;
  };
  projectPath: string;
  model?: string;
  status: 'processing' | 'complete' | 'failed';
  startedAt: string;
  completedAt: string | null;
  log: string;
  exitCode: number | null;
  commitHash?: string | null;
  commitUrl?: string | null;
}

type ModelOption = 'claude-opus-4-5-20251101' | 'claude-sonnet-4-5-20241022';

const MODEL_LABELS: Record<ModelOption, string> = {
  'claude-opus-4-5-20251101': 'Opus 4.5',
  'claude-sonnet-4-5-20241022': 'Sonnet 4.5',
};

function Popup() {
  const [activeTab, setActiveTab] = useState<'main' | 'history'>('main');
  const [isActive, setIsActive] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [serverStatus, setServerStatus] = useState<'checking' | 'running' | 'stopped'>('checking');
  const [serverPort, setServerPort] = useState<number | null>(null);
  const [projectPath, setProjectPath] = useState('');
  const [selectedModel, setSelectedModel] = useState<ModelOption>('claude-opus-4-5-20251101');
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [loadingTasks, setLoadingTasks] = useState(false);

  // Check server status and get extension state
  useEffect(() => {
    checkServerStatus();
    getExtensionState();
    loadProjectPath();
    loadSelectedModel();
  }, []);

  const loadSelectedModel = async () => {
    const storage = await chrome.storage.local.get(['selectedModel']);
    if (storage.selectedModel) {
      setSelectedModel(storage.selectedModel);
    }
  };

  const saveSelectedModel = async (model: ModelOption) => {
    setSelectedModel(model);
    await chrome.storage.local.set({ selectedModel: model });
    chrome.runtime.sendMessage({ type: 'SET_MODEL', model });
  };

  // Fetch tasks when switching to history tab
  useEffect(() => {
    if (activeTab === 'history') {
      fetchTasks();
    }
  }, [activeTab]);

  const loadProjectPath = async () => {
    const storage = await chrome.storage.local.get(['projectPath']);
    const path = storage.projectPath || '';
    setProjectPath(path);
  };

  const saveProjectPath = async (path: string) => {
    setProjectPath(path);
    chrome.runtime.sendMessage({ type: 'SET_PROJECT_PATH', path });
  };

  const checkServerStatus = async () => {
    setServerStatus('checking');
    try {
      const response = await fetch('http://localhost:3848/status');
      if (response.ok) {
        const data = await response.json();
        setServerStatus('running');
        setServerPort(data.wsPort);
      } else {
        setServerStatus('stopped');
      }
    } catch {
      setServerStatus('stopped');
    }
  };

  const fetchTasks = async () => {
    setLoadingTasks(true);
    try {
      const response = await fetch('http://localhost:3848/tasks');
      if (response.ok) {
        const taskList = await response.json();
        setTasks(taskList);
      }
    } catch {
      // Server not available
    }
    setLoadingTasks(false);
  };

  const getExtensionState = () => {
    chrome.runtime.sendMessage({ type: 'GET_STATE' }, (response) => {
      if (response) {
        setConnectionStatus(response.connectionStatus || 'disconnected');
      }
    });
  };

  const handleToggle = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab.id) {
      chrome.tabs.sendMessage(tab.id, { type: 'SET_ACTIVE', active: !isActive }).catch(() => {});
      chrome.runtime.sendMessage({ type: 'SET_ACTIVE', active: !isActive });
      setIsActive(!isActive);
    }
  };

  const handleConnect = async () => {
    if (!serverPort) return;
    setConnectionStatus('connecting');
    chrome.runtime.sendMessage({ type: 'CONNECT', port: serverPort }, (response) => {
      if (response?.success) {
        setConnectionStatus('connected');
      } else {
        setConnectionStatus('disconnected');
      }
    });
  };

  const handleDisconnect = () => {
    chrome.runtime.sendMessage({ type: 'DISCONNECT' }, () => {
      setConnectionStatus('disconnected');
    });
  };

  const formatTime = (isoString: string) => {
    const date = new Date(isoString);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  };

  const formatDate = (isoString: string) => {
    const date = new Date(isoString);
    const today = new Date();
    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    }
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  const statusColors: Record<string, string> = {
    disconnected: '#9ca3af',
    connecting: '#f59e0b',
    connected: '#22c55e',
  };

  const taskStatusColors: Record<string, string> = {
    processing: '#f59e0b',
    complete: '#22c55e',
    failed: '#ef4444',
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

      {/* Tab Navigation */}
      <div className="tab-nav">
        <button
          className={`tab-btn ${activeTab === 'main' ? 'active' : ''}`}
          onClick={() => setActiveTab('main')}
        >
          Main
        </button>
        <button
          className={`tab-btn ${activeTab === 'history' ? 'active' : ''}`}
          onClick={() => setActiveTab('history')}
        >
          History
        </button>
      </div>

      <div className="popup-content">
        {activeTab === 'main' && (
          <>
            {/* Server Status */}
            <div className="status-section">
              {serverStatus === 'checking' && (
                <div className="loading">Checking server...</div>
              )}

              {serverStatus === 'stopped' && (
                <div className="no-servers">
                  <p>Server not running</p>
                  <p className="hint">Run: launchctl start com.visualfeedback.server</p>
                  <button className="refresh-btn" onClick={checkServerStatus}>
                    Retry
                  </button>
                </div>
              )}

              {serverStatus === 'running' && (
                <>
                  {connectionStatus === 'connected' ? (
                    <>
                      <div className="connected-info">
                        <span className="connected-label">Connected</span>
                      </div>

                      <div className="project-path-section">
                        <label>Project folder:</label>
                        <div className="folder-picker-row">
                          <input
                            type="text"
                            value={projectPath}
                            onChange={(e) => saveProjectPath(e.target.value)}
                            placeholder="Select or paste path..."
                            className="project-input-with-btn"
                            readOnly
                          />
                          <button
                            className="browse-btn"
                            onClick={async () => {
                              try {
                                // @ts-ignore
                                const dirHandle = await window.showDirectoryPicker();
                                const name = dirHandle.name;
                                const path = prompt(
                                  `Selected: ${name}\n\nEnter full path to this folder:`,
                                  `/Users/coleschaffer/Desktop/${name}`
                                );
                                if (path) {
                                  saveProjectPath(path);
                                }
                              } catch (e) {
                                // User cancelled
                              }
                            }}
                          >
                            Browse
                          </button>
                        </div>
                      </div>

                      <div className="model-selector-section">
                        <label>Model:</label>
                        <select
                          value={selectedModel}
                          onChange={(e) => saveSelectedModel(e.target.value as ModelOption)}
                          className="model-select"
                        >
                          {Object.entries(MODEL_LABELS).map(([value, label]) => (
                            <option key={value} value={value}>
                              {label}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div className="toggle-row">
                        <span>Enable on current page</span>
                        <button
                          className={`toggle-btn ${isActive ? 'active' : ''}`}
                          onClick={handleToggle}
                        >
                          <span className="toggle-knob" />
                        </button>
                      </div>

                      <button className="disconnect-btn" onClick={handleDisconnect}>
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <>
                      <div className="server-info">
                        <span>Server running on port {serverPort}</span>
                      </div>
                      <button
                        className="connect-btn"
                        onClick={handleConnect}
                        disabled={connectionStatus === 'connecting'}
                      >
                        {connectionStatus === 'connecting' ? 'Connecting...' : 'Connect'}
                      </button>
                    </>
                  )}
                </>
              )}
            </div>

            <div className="instructions">
              <h3>How to use:</h3>
              <ol>
                <li>Connect to the server above</li>
                <li>Enable on page, then click elements</li>
                <li>Type feedback and click Confirm</li>
              </ol>
            </div>
          </>
        )}

        {activeTab === 'history' && (
          <div className="history-tab">
            {selectedTask ? (
              <div className="log-viewer">
                <div className="log-header">
                  <button className="back-btn" onClick={() => setSelectedTask(null)}>
                    ← Back
                  </button>
                  <div className="log-title">
                    <span
                      className="task-status-dot"
                      style={{ backgroundColor: taskStatusColors[selectedTask.status] }}
                    />
                    <span className="task-feedback-title">{selectedTask.feedback}</span>
                  </div>
                </div>
                <div className="log-meta">
                  <span>&lt;{selectedTask.element.tag}&gt;</span>
                  <span>{selectedTask.model ? MODEL_LABELS[selectedTask.model as ModelOption] || selectedTask.model : 'Opus 4'}</span>
                  <span>{formatTime(selectedTask.startedAt)}</span>
                </div>
                {selectedTask.commitUrl && (
                  <div className="commit-link">
                    <a href={selectedTask.commitUrl} target="_blank" rel="noopener noreferrer">
                      View Commit → {selectedTask.commitHash?.slice(0, 7)}
                    </a>
                  </div>
                )}
                <div className="log-content">
                  <pre>{selectedTask.log || 'No output yet...'}</pre>
                </div>
              </div>
            ) : (
              <>
                <div className="history-header">
                  <span>Recent Tasks</span>
                  <button className="refresh-btn" onClick={fetchTasks}>
                    ↻
                  </button>
                </div>

                {loadingTasks ? (
                  <div className="loading">Loading tasks...</div>
                ) : tasks.length === 0 ? (
                  <div className="no-tasks">
                    <p>No tasks yet</p>
                    <p className="hint">Submit feedback to see history here</p>
                  </div>
                ) : (
                  <div className="task-list">
                    {tasks.map((task) => (
                      <button
                        key={task.id}
                        className="task-item"
                        onClick={() => setSelectedTask(task)}
                      >
                        <div className="task-row">
                          <span
                            className="task-status-dot"
                            style={{ backgroundColor: taskStatusColors[task.status] }}
                          />
                          <span className="task-feedback">{task.feedback}</span>
                        </div>
                        <div className="task-meta">
                          <span className="task-element">&lt;{task.element.tag}&gt;</span>
                          <span className="task-time">
                            {formatDate(task.startedAt)} {formatTime(task.startedAt)}
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="popup-footer">
        <span>v1.0.0</span>
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
