import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useApi } from '../api/ApiProvider';
import { ApiError, type FeedCard as Card } from '../api/types';
import { FeedCard } from './FeedCard';

const FEED_LIMIT = 20;

const Heading = () => <h1 className="visually-hidden">Your feed</h1>;

type State = { status: 'loading' } | { status: 'error'; message: string } | { status: 'ready'; cards: Card[] };

export function FeedPage() {
  const { api } = useApi();
  const [state, setState] = useState<State>({ status: 'loading' });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    setState({ status: 'loading' });
    api.feed(FEED_LIMIT, { signal }).then(
      (cards) => {
        if (signal.aborted) return;
        setState({ status: 'ready', cards });
      },
      (e: unknown) => {
        if (signal.aborted) return;
        setState({ status: 'error', message: e instanceof ApiError ? e.message : 'Something went wrong loading your feed. Try again.' });
      },
    );
    return () => controller.abort();
  }, [api, attempt]);

  if (state.status === 'loading') {
    return (
      <main className="feed-column">
      <Heading />
        <div className="feed-card feed-card-dark feed-solo">
          <p role="status" aria-label="Loading your feed" className="help">
            Loading…
          </p>
        </div>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="feed-column">
      <Heading />
        <div className="feed-card feed-card-dark feed-solo">
          <div className="stack">
            <p role="alert" className="notice notice-error">
              {state.message}
            </p>
            <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>
              Try again
            </button>
          </div>
        </div>
      </main>
    );
  }

  if (state.cards.length === 0) {
    return (
      <main className="feed-column">
      <Heading />
        <div className="feed-card feed-card-dark feed-solo">
          <div className="stack">
            <p className="feed-empty">Nothing to celebrate yet. Add your first record.</p>
            <Link className="btn btn-primary btn-link" to="/add">
              Add a record
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="feed-column">
      <Heading />
      <div className="feed-scroller" role="region" aria-label="Your feed" tabIndex={0}>
        {state.cards.map((c, i) => (
          <FeedCard key={c.id} card={c} skipTabbable={i === 0} />
        ))}
        <section className="feed-card feed-card-dark" aria-label="You're caught up">
          <div className="stack">
            <h2 className="display feed-caught-up">You're caught up</h2>
            <div className="row">
              <Link className="btn btn-primary btn-link" to="/dashboards">
                See dashboards
              </Link>
              <Link className="btn btn-link" to="/add">
                Add a record
              </Link>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
