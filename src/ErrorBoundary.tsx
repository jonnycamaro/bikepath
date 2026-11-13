import { Component, type ReactNode } from 'react';

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div style={{ padding: 30, fontFamily: 'system-ui', textAlign: 'center' }}>
        <h2>Ups – etwas ist schiefgelaufen</h2>
        <p style={{ color: '#5b6b7f' }}>{this.state.error.message}</p>
        <button className="btn primary" onClick={() => location.reload()}>Neu laden</button>
        <p style={{ color: '#5b6b7f', fontSize: 13 }}>Deine gespeicherten Routen und eine laufende Aufnahme bleiben erhalten.</p>
      </div>
    );
  }
}
