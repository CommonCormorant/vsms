# VSMS Text Framework & Tools (`server/tf`)

## 1. Purpose
`server/tf` (Text Framework / Text Formatting) contains auxiliary text processing tools, Markov chain language models, PDF document sources, and personality training data used to generate text or analyze historical chat logs.

## 2. Contents
- `Markov/`: A standalone Go application (`main.go`) that constructs a Markov chain model from database chat history (`chat_messages` and `chat_archives`) and PDF source text to generate synthetic sentences.
- `pdf/`: Contains PDF reference materials (`tyzmon2014.pdf`).
- `personality/`: Contains raw personality text data (`tyzmonfan`).

## 3. Role in VSMS
Provides AI/personality text generation capabilities, offline language modeling on chat archives, and source material processing for bot personalities (e.g., Tyzmon or Exie bots).

## 4. Important Code
- `tf/Markov/main.go`:
  - Connects to MySQL database `vsms`.
  - Reads messages from `chat_messages` and `chat_archives`.
  - Parses pipe-delimited chat logs (`MSG` / `EMOTE`), applies handle weighting, tokenizes text.
  - Reads `pdf/tyzmon2014.pdf` using `github.com/ledongthuc/pdf`.
  - Builds bigram prefix Markov model (`Model.AddMessageTokens`).
  - Generates synthetic chat sentences (`Model.GenerateSentence`).

## 5. Dependencies
- **Database**: Accesses MySQL `vsms` database.
- **Go Packages**: `github.com/ledongthuc/pdf`, `github.com/go-sql-driver/mysql`.

## 6. Current State
Experimental / supporting toolchain for bot personality generation and text analysis.
