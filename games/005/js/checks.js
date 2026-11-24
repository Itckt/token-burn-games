(function (root) {
  'use strict';
  const questions = [
    {
      topic: 'Fit', prompt: 'A narrower dry block goes into the same tapered cup. Where does it settle?',
      options: ['Lower in the cup', 'At the original height', 'Closer to the rim'], correct: 0,
      feedback: [
        'A smaller block travels farther before the walls catch it. A small enough block reaches the floor.',
        'The sloping wall supports the edges. A narrower block passes the original seating line.',
        'The cup is wider near the rim. A narrower block passes through that part and settles farther down.'
      ],
      inspect: 'Try the narrow block', evidence: {mode:'packing', diameter:72}
    },
    {
      topic: 'Transit', prompt: 'Your lunch bag takes a knock in Kowloon Tong. Which movement uses the clearance?',
      options: ['The block slides down the walls', 'The base flexes toward the noodles', 'The block rebounds off the floor'], correct: 1,
      feedback: [
        'The wedged edges hold the block at its seating line while the cup and block move together.',
        'The base bends into the pocket. In this bump there is still clearance beneath the brittle curls.',
        'Look at the bracket under the block. Even at the peak of this bump the floor stays clear of the noodles.'
      ],
      inspect: 'Freeze the bump', evidence: {mode:'lesson', time:root.CupLesson.bumpTime}
    },
    {
      topic: 'Water', prompt: 'The pool is halfway up the block. Which curls are already below the waterline?',
      options: ['Only the curls under the pour stream', 'All the curls in the block', 'The lower curls across the block'], correct: 2,
      feedback: [
        'The stream wets a small area on top. Water that collects in the pocket spreads across the cup.',
        'The upper curls still stand above the pool, even though the stream can splash them.',
        'Water fills the pocket and rises across the underside. The upper curls can still be above the pool.'
      ],
      inspect: 'Trace the waterline', evidence: {mode:'lesson', waterline:0.5}
    }
  ];

  function mount(inspect) {
    const byId = id => document.getElementById(id);
    let current = 0;
    const answers = questions.map(() => null);
    const solved = i => answers[i] === questions[i].correct;
    function button(parent, label, handler) {
      const node = document.createElement('button');
      node.type = 'button'; node.textContent = label;
      node.addEventListener('click', handler);
      byId(parent).append(node);
      return node;
    }
    const topics = questions.map((q,i) => button('check-topics',q.topic,() => {
      current = i; update();
    }));
    const options = questions[0].options.map((_,i) => button('check-options','',() => {
      if (solved(current)) return;
      answers[current] = i; update();
    }));
    function update() {
      const q = questions[current], choice = answers[current], done = solved(current);
      const count = questions.filter((_,i) => solved(i)).length;
      byId('check-count').textContent = count+' of '+questions.length+' correct';
      byId('check-question').textContent = q.prompt;
      topics.forEach((b,i) => {
        b.setAttribute('aria-pressed',String(i===current));
        b.setAttribute('aria-label',questions[i].topic+(solved(i) ? ', answered correctly' : ''));
        b.dataset.solved = String(solved(i));
      });
      options.forEach((b,i) => {
        b.textContent = q.options[i];
        b.setAttribute('aria-pressed',String(i===choice));
        b.setAttribute('aria-disabled',String(done));
        b.dataset.result = i===choice ? (done ? 'correct' : 'retry') : '';
      });
      const feedback = byId('check-feedback');
      feedback.textContent = choice === null ? '' : (done ? 'Correct. ' : 'Try again. ')+q.feedback[choice];
      feedback.dataset.result = done ? 'correct' : 'retry';
      byId('check-evidence').hidden = choice === null;
      byId('check-evidence').textContent = q.inspect;
      byId('check-next').hidden = !done || count === questions.length;
      byId('check-restart').hidden = count !== questions.length;
    }
    byId('check-evidence').addEventListener('click',() => inspect(questions[current].evidence));
    byId('check-next').addEventListener('click',() => {
      for (let offset=1; offset<questions.length; offset++) {
        const index = (current+offset)%questions.length;
        if (!solved(index)) { current = index; break; }
      }
      update(); topics[current].focus();
    });
    byId('check-restart').addEventListener('click',() => {
      answers.fill(null); current = 0; update(); topics[0].focus();
    });
    update();
  }
  root.CupChecks = {mount};
})(globalThis);
