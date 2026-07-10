/**
 * JURIA — Découpage d'un texte en chunks pour le RAG.
 *
 * Version partagée du prepareChunksForRAG historique (copies locales encore
 * présentes dans analyse-contrat.html et comparaison-contrats.html — à faire
 * converger ici lors d'un prochain nettoyage).
 *
 * Retourne des lignes prêtes pour `document_chunks` (sans document_id ni
 * chunk_version, ajoutés par l'appelant) : chunk_index, page_number,
 * section_title, start_char, end_char, content, token_count,
 * indexing_status='pending', embedding=null.
 */
function juriaPrepareChunks(extractedText) {
  const chunks = [];

  const chunkSizeTokens = 400;                 // max tokens par chunk
  const chunkSizeChars = chunkSizeTokens * 4;  // approximation : 1 token ≈ 4 chars
  const tokenEstimate = (text) => Math.ceil(text.length / 4);

  let charPosition = 0;
  let chunkIndex = 0;
  const pageNumber = 1; // approximatif : la pagination réelle n'est pas suivie

  const paragraphs = (extractedText || '')
    .split('\n\n')
    .filter((p) => p.trim().length > 0);

  let currentChunk = '';
  let chunkStartChar = 0;

  paragraphs.forEach((para) => {
    const paraWithBreak = para + '\n\n';
    const combinedLength = (currentChunk + paraWithBreak).length;

    if (combinedLength > chunkSizeChars && currentChunk.length > 0) {
      chunks.push({
        chunk_index: chunkIndex,
        page_number: pageNumber,
        section_title: null,
        start_char: chunkStartChar,
        end_char: chunkStartChar + currentChunk.length,
        content: currentChunk.trim(),
        token_count: tokenEstimate(currentChunk),
        indexing_status: 'pending',
        embedding: null,
      });
      chunkIndex++;
      currentChunk = '';
      chunkStartChar = charPosition;
    }

    currentChunk += paraWithBreak;
    charPosition += paraWithBreak.length;
  });

  if (currentChunk.trim().length > 0) {
    chunks.push({
      chunk_index: chunkIndex,
      page_number: pageNumber,
      section_title: null,
      start_char: chunkStartChar,
      end_char: chunkStartChar + currentChunk.length,
      content: currentChunk.trim(),
      token_count: tokenEstimate(currentChunk),
      indexing_status: 'pending',
      embedding: null,
    });
  }

  return chunks;
}
