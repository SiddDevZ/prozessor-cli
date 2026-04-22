import { EventEmitter } from 'events';

const DEFAULT_BUFFER_SIZE = 500;

class LogStore extends EventEmitter {
  constructor(bufferSize = DEFAULT_BUFFER_SIZE) {
    super();
    this.bufferSize = bufferSize;
    this.logs = {};        
    this.globalLog = [];   
  }

  setBufferSize(size) {
    this.bufferSize = size;

    for (const name of Object.keys(this.logs)) {
      if (this.logs[name].length > size) {
        this.logs[name] = this.logs[name].slice(-size);
      }
    }
    if (this.globalLog.length > size * 2) {
      this.globalLog = this.globalLog.slice(-(size * 2));
    }
  }

  ensureProject(name) {
    if (!this.logs[name]) this.logs[name] = [];
  }

  push(projectName, text, stream = 'stdout') {
    this.ensureProject(projectName);

    const lines = text.split('\n');
    for (const line of lines) {
      if (line.trim() === '') continue;
      const entry = { project: projectName, text: line, stream, ts: Date.now() };
      this.logs[projectName].push(entry);
      this.globalLog.push(entry);

      if (this.logs[projectName].length > this.bufferSize) {
        this.logs[projectName].shift();
      }
    }

    const maxGlobal = this.bufferSize * 3;
    if (this.globalLog.length > maxGlobal) {
      this.globalLog = this.globalLog.slice(-this.bufferSize * 2);
    }

    this.emit('line', { project: projectName, text, stream });
  }

  getLines(projectName, count = 50) {
    this.ensureProject(projectName);
    return this.logs[projectName].slice(-count);
  }

  getAllInterleaved(count = 100) {
    return this.globalLog.slice(-count);
  }

  getProjectNames() {
    return Object.keys(this.logs);
  }

  clear(projectName) {
    if (projectName) {
      this.logs[projectName] = [];
      this.globalLog = this.globalLog.filter((e) => e.project !== projectName);
    } else {
      this.logs = {};
      this.globalLog = [];
    }
  }
}

const logStore = new LogStore();
export default logStore;
