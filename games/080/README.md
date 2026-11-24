# Street Cantonese · 街談

A pocket dictionary of 40 Hong Kong slang and colloquial expressions. Each entry has a traditional Chinese headword, tone-numbered Jyutping, an English meaning, a usage note, and an original example sentence with its own reading and translation.

> **埋單** · `maai4 daan1` · Settle the bill  
> 唔該，埋單。 · `m4 goi1 maai4 daan1` · “The bill, please.”

## Run in the terminal

From this folder, start a session with the installed Node.js runtime. The project uses only local files and the standard library. It was tested with Node.js 22.22.3.

```sh
node cli.js
```

Type a word to search. Use `/browse` to scan the dictionary, `/topics` to see the topic IDs, `/quiz` to practise, and `/quit` to leave. Inside the session, `/browse` and `/quiz` accept the same options as the one-shot commands below.

```sh
node cli.js search ceoi1seoi2
node cli.js search 放飞机
node cli.js search "split cost" --topic food
node cli.js topics
node cli.js browse --topic plans
node cli.js quiz --topic work --mode reading --count 3
node cli.js --help
```

### Search

- **Chinese** matches full or partial headwords, including listed spelling variants. Searching `放飞机` finds **放飛機**.
- **Jyutping** accepts syllable prefixes, mixed case, optional spaces or hyphens, and optional tone numbers. `ceoi seoi`, `CEOI1-SEOI2`, and `ceoiseoi2` all find **吹水**. Every tone you include must match.
- **English** searches meanings and keywords. Try `queue`, `improvise`, or `split cost`. Multiple words can appear in any order.

Use `--topic` to narrow a search, browse a collection, or practise one topic. The IDs are `talk`, `people`, `plans`, `work`, and `food`. The default is `all`.

### Quiz

A round defaults to five questions, or the number of available expressions in a smaller collection. Each entry is the target of at most one question per round. Multiple-choice modes offer four answers from the same topic. Pick `1`–`4` or submit a typed reading for immediate feedback. Enter `q` to finish early. The score uses the questions you answered. Missed answers appear again at the end with their corrections.

| Mode | Prompt | Your answer |
| --- | --- | --- |
| `meaning` | Cantonese expression and Jyutping | English meaning |
| `term` | English meaning | Cantonese expression |
| `reading` | Cantonese expression | Jyutping reading |
| `mixed` (default) | Rotates through the three multiple-choice directions | The answer requested in each question |
| `type` | Cantonese expression | Type its complete Jyutping reading |
| `cloze` | Example sentence with missing characters and an English translation | Choose the missing expression |

Set `--count` to any whole number from 1 up to the size of the selected collection.

## Local webpage

The webpage loads its scripts, dictionary, and stylesheet directly from this folder. Select an expression to see its example and Jyutping tone key. Switching between **Dictionary** and **Quiz** keeps your search and current round for the page session. [Local dictionary](index.html)

## Run the tests

```sh
node run-tests.js
```

The suite uses Node's built-in test runner in a single process. It checks the dictionary records and transcriptions, search results, shuffled questions, scoring, terminal input, and invalid or interrupted rounds. The webpage tests load its actual scripts against a small in-memory DOM fixture and exercise searching, answering, switching views, and reviewing mistakes. All tests run from the command line.

## Round 2

**Find an expression from its example.** Choose **Example sentences** in the webpage's search bar or pass `--examples` to a terminal search. Look up part of the Chinese sentence, its Jyutping, or its English translation. Topic and phrasebook filters work here too. Try `Kowloon Tong` for **迫爆** on a packed platform, `HKBU` for **開夜車** before an assignment deadline, or `deck wins` for **屈機**.

```sh
node cli.js search --examples "Kowloon Tong"
node cli.js search --examples lung4tong4 --topic plans
```

**Keep a personal phrasebook.** Select **Save to phrasebook** on an entry, then use **Phrasebook only** to find it again. In the terminal, `book add` and `book remove` accept a full headword, listed spelling variant or complete reading. `book` lists your saved expressions. Add `--saved` to search, browse or quiz. Even a one-expression book supports a full set of four choices from that expression's topic.

```sh
node cli.js book add bik1baau3
node cli.js book
node cli.js quiz --saved --mode type
node cli.js book remove 迫爆
```

The terminal stores one marker per saved expression in `.street-cantonese/` beside `cli.js`. The webpage keeps its own phrasebook in local browser storage. If storage is unavailable, the page shows a notice and keeps your changes for the current session.

**Write the Jyutping from memory.** In `type` mode, enter one tone number from 1 to 6 for each syllable. For **迫爆**, `bik1baau3`, `BIK1-BAAU3` and `bik1 baau3` are equivalent. An incomplete reading gives you another try. A complete answer with a mistake counts once and shows the correction beside the affected character. For `bik1 baau2`, the feedback is **爆 · baau2 → baau3 (tone 3, mid level)**.

**Retry missed questions.** Choose **Retry missed questions** on the results page, or enter `/retry` after a quiz in an interactive terminal session. The retry starts a fresh score and keeps each missed question's direction. Ending a round early includes only the misses you actually answered.

The lookup index now prepares the example and headword searches in one place. Both interfaces share quiz grading and correction text. Interactive commands now handle quoted readings and topic arguments, including `/search "ceoi1 seoi2"`. The expanded suite covers these changes, phrasebook reloads and storage failures, strict tone input, small collections and partial-round retries.

## Round 3

**Read a Cantonese message.** Paste text into **Reader** to highlight expressions from the dictionary. Each headword appears once in the vocabulary list, with its Jyutping, meaning, and any different spellings found in the passage. Select a headword to open its entry. The reader recognises listed variants such as 搭檯 and common split forms such as 吹陣水. On the command line, use `read`, `read -` for multiline UTF-8 input, or `/read` in a session.

```sh
node cli.js read "交完功課，我哋喺九龍塘搭枱食飯，吹陣水。"
```

**Practise the words you just read.** Choose **Set up a passage quiz** below the vocabulary list, or pass the text to `quiz --passage`. Each distinct expression is eligible once. You can narrow the selection by topic or phrasebook and use any quiz mode. Starting a round fixes its question set, so you can edit the passage while you practise.

**Fill the sentence gaps.** In **Sentence gaps** (`cloze`) mode, choose the expression that completes a Cantonese example using its English translation as a hint. Each square hides one character. **放飛機** fits **你尋日□我□□喎。** The pronoun 我 stays in the sentence. After you answer, the quiz shows the complete sentence and its Jyutping. Missed sentences are available for retry.

```sh
node cli.js quiz --passage "你放我飛機，下次你埋單！" --mode cloze
```

**Move a phrasebook between the webpage and terminal.** Open **Import or export a phrasebook** in the Dictionary. Export selects one canonical headword per line for copying. To import, paste a list and choose **Import list**. Both interfaces accept headwords, listed variants and complete readings. They check every line before saving, report the line number of an invalid expression, and merge duplicates into one entry.

```sh
node cli.js book import 放飞机 "maai4 daan1"
node cli.js book export
node cli.js book import -
```

`book import -` reads a UTF-8 list from standard input until EOF. If a disk write fails, the terminal reports how many expressions it added. Repeating the import picks up the remaining entries.

The reader and sentence quizzes share one matcher. Quiz setup and round creation use the same collection filters. The webpage remembers your requested question count when a filter temporarily limits the round size. Jyutping lookup now checks that explicit separators fall between syllables. The expanded tests cover all 40 sentence gaps, Unicode passage offsets, edits during a round, and phrasebook transfers across reloads and partial writes.
