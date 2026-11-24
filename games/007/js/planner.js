"use strict";

function createTwistPlanner(session, changed) {
  let worker = null, workerURL = null;

  function release() {
    if (worker) worker.terminate();
    if (workerURL) URL.revokeObjectURL(workerURL);
    worker = workerURL = null;
  }
  function accept(ticket, moves) {
    if (session.receiveSolution(ticket, moves)) changed();
  }
  function useHistory(ticket) {
    if (session.mode === "planning" && ticket === session.ticket) {
      accept(ticket, TwistCube.inverseSequence(session.history));
    }
  }
  function connect() {
    workerURL = URL.createObjectURL(new Blob([TwistSolver.workerSource()], { type: "text/javascript" }));
    const localWorker = new Worker(workerURL);
    worker = localWorker;
    worker.onmessage = ({ data }) => {
      if (localWorker !== worker || session.mode !== "planning") return;
      if (!Number.isInteger(data?.ticket)) { useHistory(session.ticket); return; }
      if (data.ticket !== session.ticket) return;
      if (data.error) { useHistory(data.ticket); return; }
      try { accept(data.ticket, data.moves); }
      catch { useHistory(data.ticket); }
    };
    worker.onerror = worker.onmessageerror = event => {
      event.preventDefault();
      if (localWorker !== worker) return;
      release();
      useHistory(session.ticket);
    };
  }
  function request() {
    const job = session.requestSolve();
    if (!job) return;
    changed();
    try {
      if (!worker) connect();
      worker.postMessage(job);
    } catch {
      release();
      useHistory(job.ticket);
    }
  }
  return { release, request };
}
