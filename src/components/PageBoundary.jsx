// If a page fails while drawing, show a plain message with a way out instead of a blank screen, and report it.
import { Component } from 'react';
import { reportError } from '../lib/errors.js';

export default class PageBoundary extends Component {
  constructor(props) { super(props); this.state = { failed: false }; }
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(error, info) { reportError(error, `page ${this.props.where || ''}\n${String(info?.componentStack || '').split('\n').slice(0, 6).join('\n')}`); }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="panel" role="alert" style={{ maxWidth: 560 }}>
        <h1 style={{ fontSize: 20 }}>This page could not be shown</h1>
        <p className="small" style={{ margin: '8px 0 16px' }}>Something in it failed to load. Your saved work is safe. The problem has been reported to the administrator.</p>
        <div className="row">
          <button className="btn primary" onClick={() => window.location.reload()}>Reload</button>
          <button className="btn" onClick={() => { this.setState({ failed: false }); this.props.onHome?.(); }}>Go to the dashboard</button>
        </div>
      </div>
    );
  }
}
