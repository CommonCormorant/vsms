package main

import (
	"database/sql"
	"fmt"
	"log"
	"math/rand"
	"regexp"
	"strings"
	"time"

	"github.com/ledongthuc/pdf"
	_ "github.com/go-sql-driver/mysql"
)

// Configuration
const (
	dsn          = "vsmsuser:/BunHun01Run%@tcp(localhost:3306)/vsms?charset=utf8mb4&parseTime=true"
	maxWords     = 40
	genSentences = 6
)

// Token regex
var tokenRegex = regexp.MustCompile(`[\p{L}\p{N}’']+|[^\s\p{L}\p{N}]`)

type Model struct {
	Next          map[string][]string
	StartPrefixes map[string]int
}

func NewModel() *Model {
	return &Model{
		Next:          make(map[string][]string),
		StartPrefixes: make(map[string]int),
	}
}

func tokenize(s string) []string {
	s = strings.TrimSpace(s)
	if s == "" {
		return nil
	}
	return tokenRegex.FindAllString(s, -1)
}

func (m *Model) AddMessageTokens(tokens []string) {
	if len(tokens) == 0 {
		return
	}
	if len(tokens) >= 2 {
		p := tokens[0] + " " + tokens[1]
		m.StartPrefixes[p]++
	} else {
		p := tokens[0] + " <END>"
		m.StartPrefixes[p]++
	}
	for i := 0; i < len(tokens)-2; i++ {
		prefix := tokens[i] + " " + tokens[i+1]
		next := tokens[i+2]
		m.Next[prefix] = append(m.Next[prefix], next)
	}
	if len(tokens) == 2 {
		prefix := tokens[0] + " " + tokens[1]
		m.Next[prefix] = append(m.Next[prefix], "<END>")
	}
	if len(tokens) == 1 {
		prefix := "<START> " + tokens[0]
		m.Next[prefix] = append(m.Next[prefix], "<END>")
	}
}

func (m *Model) RandomStartPrefix() string {
	total := 0
	for _, c := range m.StartPrefixes {
		total += c
	}
	if total == 0 {
		for p := range m.Next {
			return p
		}
		return "<START> <START>"
	}
	r := rand.Intn(total)
	for p, c := range m.StartPrefixes {
		if r < c {
			return p
		}
		r -= c
	}
	for p := range m.StartPrefixes {
		return p
	}
	return "<START> <START>"
}

func (m *Model) GenerateSentence(maxWords int) string {
	prefix := m.RandomStartPrefix()
	parts := strings.Split(prefix, " ")
	if len(parts) < 2 {
		parts = append([]string{"<START>"}, parts...)
	}
	sentence := make([]string, 0, maxWords)
	sentence = append(sentence, parts[0], parts[1])

	for len(sentence) < maxWords {
		p := sentence[len(sentence)-2] + " " + sentence[len(sentence)-1]
		nextList := m.Next[p]
		if len(nextList) == 0 {
			break
		}
		next := nextList[rand.Intn(len(nextList))]
		if next == "<END>" {
			break
		}
		sentence = append(sentence, next)
	}
	return joinTokens(sentence)
}

func joinTokens(tokens []string) string {
	if len(tokens) == 0 {
		return ""
	}
	var b strings.Builder
	for i, t := range tokens {
		if i == 0 {
			b.WriteString(t)
			continue
		}
		if isPunctOrEmoji(t) {
			if isEmoji(t) {
				b.WriteString(" ")
				b.WriteString(t)
			} else {
				b.WriteString(t)
			}
		} else {
			b.WriteString(" ")
			b.WriteString(t)
		}
	}
	s := b.String()
	re := regexp.MustCompile(`\s+([,.:;!?%])`)
	s = re.ReplaceAllString(s, "$1")
	return s
}

func isPunctOrEmoji(token string) bool {
	if token == "" {
		return false
	}
	r := []rune(token)[0]
	if (r >= 'a' && r <= 'z') || (r >= 'A' && r <= 'Z') || (r >= '0' && r <= '9') {
		return false
	}
	return true
}

func isEmoji(token string) bool {
	if token == "" {
		return false
	}
	r := []rune(token)[0]
	if r >= 0x1F300 && r <= 0x1FAFF {
		return true
	}
	if r >= 0x1F600 && r <= 0x1F64F {
		return true
	}
	if r >= 0x2600 && r <= 0x26FF {
		return true
	}
	return false
}

// --- PDF READER ADDITION ---
func extractTextFromPDF(path string) (string, error) {
	f, r, err := pdf.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()

	var textBuilder strings.Builder
	totalPage := r.NumPage()
	for pageIndex := 1; pageIndex <= totalPage; pageIndex++ {
		page := r.Page(pageIndex)
		if page.V.IsNull() {
			continue
		}
		content, err := page.GetPlainText(nil)
		if err == nil {
			textBuilder.WriteString(content)
			textBuilder.WriteString(" ")
		}
	}
	return textBuilder.String(), nil
}

func main() {
	rand.Seed(time.Now().UnixNano())

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		log.Fatalf("db open: %v", err)
	}
	defer db.Close()
	if err := db.Ping(); err != nil {
		log.Fatalf("db ping: %v", err)
	}

	weightedHandles := map[string]int{
		"Bobin Threadbare": 3,
		"cc":               3,
		"r wesley edwards": 3,
		"CommonCormorant":  3,
		"Common Cormorant": 3,
		"Shadow Shag":      3,
	}

	model := NewModel()
	var count int

	tables := []string{"chat_messages", "chat_archives"}
	for _, table := range tables {
		query := fmt.Sprintf("SELECT message FROM %s", table)
		rows, err := db.Query(query)
		if err != nil {
			log.Printf("warning: skipping %s due to query error: %v", table, err)
			continue
		}
		for rows.Next() {
			var raw sql.NullString
			if err := rows.Scan(&raw); err != nil {
				log.Fatalf("scan: %v", err)
			}
			if !raw.Valid {
				continue
			}
			parts := strings.SplitN(raw.String, "|", 3)
			if len(parts) != 3 {
				continue
			}
			prefix := parts[0]
			handle := parts[1]
			content := parts[2]

			if prefix != "MSG" && prefix != "EMOTE" {
				continue
			}

			if prefix == "EMOTE" {
				content = handle + " " + content
			}

			toks := tokenize(content)
			if len(toks) == 0 {
				continue
			}

			weight := weightedHandles[handle]
			if weight == 0 {
				weight = 1
			}
			for i := 0; i < weight; i++ {
				model.AddMessageTokens(toks)
			}
			count++
		}
		rows.Close()
		if err := rows.Err(); err != nil {
			log.Printf("rows error in %s: %v", table, err)
		}
	}

	fmt.Printf("Built model from %d chat messages, %d prefixes\n", count, len(model.Next))

	// --- integrate the PDF text ---
	pdfText, err := extractTextFromPDF("../pdf/tyzmon2014.pdf")
	if err != nil {
		log.Printf("warning: could not read PDF: %v", err)
	} else if len(pdfText) > 0 {
		fmt.Printf("Adding Tyzmon novel: %d characters\n", len(pdfText))
		toks := tokenize(pdfText)
		model.AddMessageTokens(toks)
	}

	fmt.Println("\nGenerated output:\n")
	for i := 0; i < genSentences; i++ {
		fmt.Println(model.GenerateSentence(maxWords))
	}
}