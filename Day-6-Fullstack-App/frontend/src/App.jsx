import { useEffect, useState } from "react";
import { createTask, deleteTask, listTasks, toggleTask } from "./api.js";

// ---------------------------------------------------------------------------
// A 60-second orientation to React, since this is the first one.
//
// A COMPONENT is a function that returns markup (JSX). React calls it to
// produce the page. When the data it depends on changes, React calls it AGAIN
// and updates only the parts of the real DOM that differ. You never write
// document.getElementById or .innerHTML — you describe what the page should
// look like for a given state, and React does the DOM work.
//
// useState(initial) gives you [currentValue, setter]. Calling the setter is how
// you tell React "this changed, re-render me". Assigning to a plain variable
// would change the value but React would never know to redraw.
//
// useEffect(fn, deps) runs fn AFTER a render — for things that are not
// rendering, like fetching data. The deps array controls when it re-runs;
// [] means "only once, when this component first appears".
//
// JSX rules that trip people up: `className` not `class`, `{}` embeds a JS
// expression, and a list rendered with .map() needs a stable `key` so React can
// tell the items apart between renders.
// ---------------------------------------------------------------------------

export default function App() {
  const [tasks, setTasks] = useState([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  // Re-read the list from the API and put it in state.
  //
  // Every mutation below calls this afterwards instead of patching the local
  // array. That is one extra round trip, and it is the right trade here: the
  // screen can never drift from what is actually in Postgres, which is exactly
  // what we want to be able to demonstrate.
  async function refresh() {
    try {
      setTasks(await listTasks());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  // Load once on first render. The empty [] is what means "once" — with no
  // array at all this would re-run after every render and loop forever.
  useEffect(() => {
    refresh();
  }, []);

  // Any action that changes the server: do it, then refresh, and surface
  // failures in the error banner rather than the browser console.
  async function run(action) {
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err.message);
    }
  }

  function handleSubmit(event) {
    // Without this the browser does a full page navigation on form submit —
    // the default behaviour of <form>, and the classic first-React surprise.
    event.preventDefault();
    if (title.trim() === "") return;
    run(async () => {
      await createTask(title);
      setTitle("");
    });
  }

  return (
    <main className="app">
      <header>
        <h1>Task Board</h1>
        <p className="subtitle">React → Express → Postgres, all in containers</p>
      </header>

      <form className="new-task" onSubmit={handleSubmit}>
        {/* A "controlled input": its value comes from state, and every keystroke
            writes back to state. React owns the value, not the DOM node. */}
        <input
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="What needs doing?"
          maxLength={200}
          aria-label="New task title"
        />
        <button type="submit">Add</button>
      </form>

      {/* `condition && <jsx/>` renders the element only when the condition
          holds — the usual React way to show something optionally. */}
      {error && <p className="error">{error}</p>}

      {loading ? (
        <p className="empty">Loading…</p>
      ) : tasks.length === 0 ? (
        <p className="empty">No tasks yet. Add one above.</p>
      ) : (
        <ul className="tasks">
          {tasks.map((task) => (
            // key must be stable and unique — the database id is ideal.
            <li key={task.id} className={task.done ? "done" : ""}>
              <input
                type="checkbox"
                checked={task.done}
                onChange={() => run(() => toggleTask(task.id))}
                aria-label={`Mark "${task.title}" ${task.done ? "not done" : "done"}`}
              />
              <span className="title">{task.title}</span>
              <button
                className="delete"
                onClick={() => run(() => deleteTask(task.id))}
                aria-label={`Delete "${task.title}"`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}

      <footer>
        {tasks.length} task{tasks.length === 1 ? "" : "s"} · served by nginx,
        stored in Postgres
      </footer>
    </main>
  );
}
