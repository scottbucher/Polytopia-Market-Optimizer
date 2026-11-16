import { Component, type ReactNode } from 'react';
import { clearLocal } from '../model/io';

/** Shows a way out instead of a blank page if something breaks (for example a bad saved map). */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="crash">
        <h1>Something went wrong</h1>
        <p>The page hit an error: {this.state.error.message}</p>
        <p>Your map is saved in this browser. You can reload and try again, or start over with the example map.</p>
        <div className="row">
          <button type="button" className="accent" onClick={() => location.reload()}>
            Reload
          </button>
          <button
            type="button"
            onClick={() => {
              clearLocal();
              location.reload();
            }}
          >
            Start over (clears the map saved in this browser)
          </button>
        </div>
      </div>
    );
  }
}
