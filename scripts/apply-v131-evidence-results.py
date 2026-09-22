from pathlib import Path
import json

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path, old, new):
    file = ROOT / path
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{path}: se esperaba 1 coincidencia y se encontraron {count}')
    file.write_text(text.replace(old, new, 1), encoding='utf-8')


def replace_all_checked(path, old, new, expected):
    file = ROOT / path
    text = file.read_text(encoding='utf-8')
    count = text.count(old)
    if count != expected:
        raise RuntimeError(f'{path}: se esperaban {expected} coincidencias y se encontraron {count}')
    file.write_text(text.replace(old, new), encoding='utf-8')


# 1) Resultados del alumno: puntaje individual visible al finalizar la corrección,
# sin liberar la clave correcta antes de la fecha configurada.
replace_once(
    'supabase/functions/exam-access/index.ts',
    "const EVIDENCE_QUESTION_TYPES = new Set(['calculation_evidence', 'attachment'])\n",
    "const EVIDENCE_QUESTION_TYPES = new Set(['calculation_evidence', 'attachment'])\n\nfunction questionEvidenceMode(type: string, metadata: any = {}) {\n  if (type === 'attachment' || type === 'calculation_evidence') return 'validated'\n  const mode = normalizeText(metadata?.evidenceMode).toLowerCase()\n  return ['informational', 'validated'].includes(mode) ? mode : 'none'\n}\n\nfunction questionAllowsEvidence(type: string, metadata: any = {}) {\n  return EVIDENCE_QUESTION_TYPES.has(type) || questionEvidenceMode(type, metadata) !== 'none'\n}\n"
)
replace_once(
    'supabase/functions/exam-access/index.ts',
    "  } else if (EVIDENCE_QUESTION_TYPES.has(type)) {\n    // Evidence metadata is server-owned. Ignore any client-supplied evidence fields.\n    nestedPayload = evidencePayloadFields(existing?.answer_payload)\n  }\n",
    "  } else if (questionAllowsEvidence(type, question.metadata_snapshot)) {\n    // Evidence metadata is server-owned. Ignore any client-supplied evidence fields.\n    // This also preserves informational evidence attached to automatically graded items.\n    nestedPayload = evidencePayloadFields(existing?.answer_payload)\n  }\n"
)
replace_once(
    'supabase/functions/exam-access/index.ts',
    "  if (!EVIDENCE_QUESTION_TYPES.has(String(question.question_type))) {\n    throw new AppError('EVIDENCE_NOT_ALLOWED', 'Esta pregunta no admite evidencia adjunta.', 409)\n  }\n",
    "  if (!questionAllowsEvidence(String(question.question_type), question.metadata_snapshot)) {\n    throw new AppError('EVIDENCE_NOT_ALLOWED', 'Esta pregunta no admite evidencia adjunta.', 409)\n  }\n"
)
replace_once(
    'supabase/functions/exam-access/index.ts',
    "    admin.from('calificaciones')\n      .select('pending_manual_reviews')\n",
    "    admin.from('calificaciones')\n      .select('pending_manual_reviews,final_grade,is_published')\n"
)
replace_once(
    'supabase/functions/exam-access/index.ts',
    "    const reviewed = answer?.review_status === 'reviewed'\n    const pending = answer?.review_status === 'pending'\n    const scoreVisible = answersReleased && !pending\n",
    "    const reviewed = answer?.review_status === 'reviewed'\n    const pending = answer?.review_status === 'pending'\n    // The student's own points are not an answer key. Once the attempt has a\n    // completed final grade, expose each question score while keeping correct\n    // answers and feedback under the independent answer-key embargo.\n    const completedGradeReady = Number(grade?.pending_manual_reviews || 0) === 0 && grade?.final_grade !== null && grade?.final_grade !== undefined\n    const scoreVisible = completedGradeReady && !pending\n"
)

# 2) PDF: an omitted item must not also be counted as incorrect.
replace_once(
    'src/services/examPdfReport.js',
    "function countQuestions(questions) {\n  let correct = 0; let incorrect = 0; let omitted = 0; let answered = 0\n  questions.forEach((row) => {\n    const answer = String(row.studentAnswer || '').trim().toLowerCase()\n    const isOmitted = !answer || answer === 'omitida' || answer === 'sin respuesta'\n    if (isOmitted) omitted += 1\n    else answered += 1\n    if (row.isCorrect === true) correct += 1\n    else if (row.isCorrect === false) incorrect += 1\n  })\n  return { correct, incorrect, omitted, answered, total: questions.length }\n}\n",
    "function countQuestions(questions) {\n  let correct = 0; let incorrect = 0; let omitted = 0; let answered = 0\n  questions.forEach((row) => {\n    const answer = String(row.studentAnswer || '').trim().toLowerCase()\n    const isOmitted = !answer || answer === 'omitida' || answer === 'sin respuesta'\n    if (isOmitted) {\n      omitted += 1\n      return\n    }\n    answered += 1\n    if (row.isCorrect === true) correct += 1\n    else if (row.isCorrect === false) incorrect += 1\n  })\n  return { correct, incorrect, omitted, answered, total: questions.length }\n}\n"
)

# 3) Evidencia informativa en preguntas automáticas. El tipo legado
# calculation_evidence conserva su revisión manual obligatoria.
replace_once(
    'src/components/StudentQuestionRenderer.jsx',
    "      {question.type === 'case_group'\n        ? <CaseGroup question={question} answer={answer} onChange={onChange} />\n        : <AnswerFields\n            question={question}\n            answer={answer}\n            onChange={onChange}\n            evidence={evidence}\n            sessionToken={sessionToken}\n            onEvidenceChange={onEvidenceChange}\n            disabled={disabled}\n          />}\n",
    "      {question.type === 'case_group'\n        ? <CaseGroup question={question} answer={answer} onChange={onChange} />\n        : <AnswerFields\n            question={question}\n            answer={answer}\n            onChange={onChange}\n            evidence={evidence}\n            sessionToken={sessionToken}\n            onEvidenceChange={onEvidenceChange}\n            disabled={disabled}\n          />}\n      {question.type !== 'case_group'\n        && !['calculation_evidence', 'attachment'].includes(question.type)\n        && ['informational', 'validated'].includes(String(question.metadata?.evidenceMode || '').toLowerCase())\n        && (\n          <StudentEvidenceUploader\n            questionId={question.id}\n            sessionToken={sessionToken}\n            evidence={evidence}\n            disabled={disabled}\n            onEvidenceChange={onEvidenceChange}\n          />\n        )}\n"
)

replace_once(
    'src/components/QuestionEditorModal.jsx',
    "      {question.type !== 'case_group' && <AnswerConfiguration question={question} onChange={patchQuestion} />}\n      {question.type === 'case_group' && <CaseChildrenEditor question={question} onChange={patchQuestion} />}\n\n      <section className=\"editor-subsection\"><label>Retroalimentación / explicación opcional<textarea value={question.explanation} onChange={(event) => patchQuestion({ explanation: event.target.value })} placeholder=\"Explica la solución o el criterio que podrá mostrarse cuando el examen lo permita.\" /></label></section>\n",
    "      {question.type !== 'case_group' && <AnswerConfiguration question={question} onChange={patchQuestion} />}\n      {question.type === 'case_group' && <CaseChildrenEditor question={question} onChange={patchQuestion} />}\n\n      {question.type !== 'case_group' && (\n        <section className=\"editor-subsection\">\n          <div className=\"section-label-row\">\n            <div><strong>Evidencia del estudiante</strong><span>La evidencia puede conservarse para auditoría sin convertir una pregunta automática en corrección manual.</span></div>\n          </div>\n          {['calculation_evidence', 'attachment'].includes(question.type) ? (\n            <div className=\"field-hint\">Este tipo exige evidencia y mantiene revisión docente antes de consolidar su puntaje.</div>\n          ) : (\n            <label>Modo de evidencia\n              <select\n                value={question.metadata?.evidenceMode || 'none'}\n                onChange={(event) => patchQuestion({ metadata: { ...(question.metadata || {}), evidenceMode: event.target.value } })}\n              >\n                <option value=\"none\">Sin evidencia</option>\n                <option value=\"informational\">Evidencia informativa / auditable</option>\n              </select>\n              <span className=\"field-hint\">En modo informativo la respuesta conserva su calificación automática y el archivo queda disponible en Evidencias para revisión docente.</span>\n            </label>\n          )}\n        </section>\n      )}\n\n      <section className=\"editor-subsection\"><label>Retroalimentación / explicación opcional<textarea value={question.explanation} onChange={(event) => patchQuestion({ explanation: event.target.value })} placeholder=\"Explica la solución o el criterio que podrá mostrarse cuando el examen lo permita.\" /></label></section>\n"
)

# 4) Bandeja de evidencias: incluir estado y puntaje de la respuesta para que
# una evidencia automática siga siendo visible y auditable.
replace_once(
    'src/services/evidenceManagement.js',
    "  const studentIds = [...new Set(closedAttempts.map((row) => row.student_id).filter(Boolean))]\n  const examIds = [...new Set(closedAttempts.map((row) => row.exam_id).filter(Boolean))]\n  const [{ data: students, error: studentsError }, { data: exams, error: examsError }] = await Promise.all([\n",
    "  const studentIds = [...new Set(closedAttempts.map((row) => row.student_id).filter(Boolean))]\n  const examIds = [...new Set(closedAttempts.map((row) => row.exam_id).filter(Boolean))]\n  const responseIds = [...new Set(filtered.map((row) => row.response_id).filter(Boolean))]\n  const [{ data: students, error: studentsError }, { data: exams, error: examsError }, { data: responses, error: responsesError }] = await Promise.all([\n"
)
replace_once(
    'src/services/evidenceManagement.js',
    "    examIds.length\n      ? supabase.from(TABLES.EXAMS).select('id,title,course_id').in('id', examIds)\n      : Promise.resolve({ data: [], error: null }),\n  ])\n  if (studentsError) throw studentsError\n  if (examsError) throw examsError\n",
    "    examIds.length\n      ? supabase.from(TABLES.EXAMS).select('id,title,course_id').in('id', examIds)\n      : Promise.resolve({ data: [], error: null }),\n    responseIds.length\n      ? supabase.from(TABLES.ANSWERS).select('id,is_answered,is_correct,auto_score,manual_score,review_status,teacher_feedback').in('id', responseIds)\n      : Promise.resolve({ data: [], error: null }),\n  ])\n  if (studentsError) throw studentsError\n  if (examsError) throw examsError\n  if (responsesError) throw responsesError\n"
)
replace_once(
    'src/services/evidenceManagement.js',
    "  const questionMap = new Map((questions || []).map((row) => [row.id, row]))\n\n  return filtered.map((row) => {\n",
    "  const questionMap = new Map((questions || []).map((row) => [row.id, row]))\n  const responseMap = new Map((responses || []).map((row) => [row.id, row]))\n\n  return filtered.map((row) => {\n"
)
replace_once(
    'src/services/evidenceManagement.js',
    "      exam: attempt ? examMap.get(attempt.exam_id) ?? null : null,\n      question: questionMap.get(row.attempt_question_id) ?? null,\n",
    "      exam: attempt ? examMap.get(attempt.exam_id) ?? null : null,\n      question: questionMap.get(row.attempt_question_id) ?? null,\n      response: responseMap.get(row.response_id) ?? null,\n"
)

# 5) Evidencias: filtros por examen y estado, estado visible y acción coherente
# para evidencias informativas que no requieren corrección manual.
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "import { Link } from 'react-router-dom'\n",
    "import { Link, useSearchParams } from 'react-router-dom'\n"
)
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "export default function TeacherEvidencePage() {\n  const { formatDateTime } = useGlobalSettings()\n",
    "export default function TeacherEvidencePage() {\n  const { formatDateTime } = useGlobalSettings()\n  const [searchParams] = useSearchParams()\n"
)
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "  const [message, setMessage] = useState('')\n  const [query, setQuery] = useState('')\n",
    "  const [message, setMessage] = useState('')\n  const [query, setQuery] = useState('')\n  const [examFilter, setExamFilter] = useState(() => searchParams.get('exam') || '')\n  const [statusFilter, setStatusFilter] = useState('all')\n"
)
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "  const filtered = useMemo(() => {\n    const term = query.trim().toLowerCase()\n    if (!term) return items\n    return items.filter((item) => {\n      const haystack = [\n        studentName(item.student), item.exam?.title,\n        item.question?.prompt_snapshot, item.original_filename,\n      ].filter(Boolean).join(' ').toLowerCase()\n      return haystack.includes(term)\n    })\n  }, [items, query])\n",
    "  const exams = useMemo(() => {\n    const map = new Map()\n    items.forEach((item) => { if (item.exam?.id) map.set(item.exam.id, item.exam.title || 'Examen') })\n    return [...map.entries()].sort((a, b) => a[1].localeCompare(b[1], 'es'))\n  }, [items])\n\n  const filtered = useMemo(() => {\n    const term = query.trim().toLowerCase()\n    return items.filter((item) => {\n      if (examFilter && item.exam?.id !== examFilter) return false\n      const reviewStatus = item.response?.review_status || 'not_required'\n      if (statusFilter === 'pending' && reviewStatus !== 'pending') return false\n      if (statusFilter === 'reviewed' && reviewStatus !== 'reviewed') return false\n      if (statusFilter === 'automatic' && reviewStatus !== 'not_required') return false\n      if (!term) return true\n      const haystack = [\n        studentName(item.student), item.exam?.title,\n        item.question?.prompt_snapshot, item.original_filename,\n      ].filter(Boolean).join(' ').toLowerCase()\n      return haystack.includes(term)\n    })\n  }, [items, query, examFilter, statusFilter])\n"
)
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "        description=\"Archivos adjuntados en intentos ya enviados. Los archivos permanecen privados y se abren mediante enlaces temporales.\"\n",
    "        description=\"Archivos adjuntados en intentos ya enviados. La evidencia permanece visible para auditoría aunque la pregunta haya sido calificada automáticamente.\"\n"
)
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "          <div className=\"evidence-search\"><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder=\"Buscar alumno, examen o archivo\" /></div>\n",
    "          <div className=\"evidence-search\">\n            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder=\"Buscar alumno, examen o archivo\" />\n            <select value={examFilter} onChange={(event) => setExamFilter(event.target.value)} aria-label=\"Filtrar por examen\">\n              <option value=\"\">Todos los exámenes</option>\n              {exams.map(([id, title]) => <option key={id} value={id}>{title}</option>)}\n            </select>\n            <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label=\"Filtrar por revisión\">\n              <option value=\"all\">Todos los estados</option>\n              <option value=\"pending\">Pendiente de revisión</option>\n              <option value=\"reviewed\">Revisada</option>\n              <option value=\"automatic\">Automática / informativa</option>\n            </select>\n          </div>\n"
)
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "                <StatusBadge tone=\"neutral\">{item.mime_type === 'application/pdf' ? 'PDF' : 'Imagen'}</StatusBadge>\n                <small>{formatBytes(item.size_bytes)}</small>\n",
    "                <StatusBadge tone={item.response?.review_status === 'pending' ? 'warning' : item.response?.review_status === 'reviewed' ? 'success' : 'neutral'}>\n                  {item.response?.review_status === 'pending' ? 'Pendiente' : item.response?.review_status === 'reviewed' ? 'Revisada' : 'Automática'}\n                </StatusBadge>\n                <small>{item.mime_type === 'application/pdf' ? 'PDF' : 'Imagen'} · {formatBytes(item.size_bytes)}</small>\n"
)
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "                <StatusBadge tone=\"neutral\">{selected.mime_type === 'application/pdf' ? 'PDF' : 'Imagen'}</StatusBadge>\n",
    "                <StatusBadge tone={selected.response?.review_status === 'pending' ? 'warning' : selected.response?.review_status === 'reviewed' ? 'success' : 'neutral'}>\n                  {selected.response?.review_status === 'pending' ? 'Pendiente' : selected.response?.review_status === 'reviewed' ? 'Revisada' : 'Evidencia informativa'}\n                </StatusBadge>\n"
)
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "              <div className=\"evidence-detail-grid\">\n                <div><span>Archivo</span><strong>{selected.original_filename}</strong></div>\n                <div><span>Tamaño</span><strong>{formatBytes(selected.size_bytes)}</strong></div>\n                <div><span>Subido</span><strong>{formatDateTime(selected.uploaded_at)}</strong></div>\n                <div><span>Entrega</span><strong>{formatDateTime(selected.attempt?.submitted_at)}</strong></div>\n              </div>\n",
    "              <div className=\"evidence-detail-grid\">\n                <div><span>Archivo</span><strong>{selected.original_filename}</strong></div>\n                <div><span>Tamaño</span><strong>{formatBytes(selected.size_bytes)}</strong></div>\n                <div><span>Subido</span><strong>{formatDateTime(selected.uploaded_at)}</strong></div>\n                <div><span>Entrega</span><strong>{formatDateTime(selected.attempt?.submitted_at)}</strong></div>\n                <div><span>Puntaje automático</span><strong>{selected.response?.auto_score == null ? '—' : selected.response.auto_score}</strong></div>\n                <div><span>Puntaje manual</span><strong>{selected.response?.manual_score == null ? '—' : selected.response.manual_score}</strong></div>\n              </div>\n"
)
replace_once(
    'src/pages/TeacherEvidencePage.jsx',
    "                <Link className=\"button primary\" to={`/docente/calificacion?response=${selected.response_id}`}>Calificar respuesta</Link>\n                <span className=\"muted-copy\">La calificación manual sustituye el puntaje automático preliminar de esta pregunta.</span>\n",
    "                {['pending', 'reviewed'].includes(selected.response?.review_status) && <Link className=\"button primary\" to={`/docente/calificacion?response=${selected.response_id}`}>Calificar respuesta</Link>}\n                <span className=\"muted-copy\">{['pending', 'reviewed'].includes(selected.response?.review_status) ? 'La revisión docente puede confirmar o sustituir el puntaje preliminar.' : 'Esta evidencia es auditable y no modifica por sí sola la calificación automática.'}</span>\n"
)

# 6) Acceso directo desde Resultados a Evidencias del examen seleccionado.
replace_once(
    'src/pages/TeacherResultsPage.jsx',
    "import { useEffect, useMemo, useState } from 'react'\n",
    "import { useEffect, useMemo, useState } from 'react'\nimport { Link } from 'react-router-dom'\n"
)
replace_once(
    'src/pages/TeacherResultsPage.jsx',
    "            <button className=\"button secondary\" type=\"button\" onClick={reload} disabled={!examId || loading || Boolean(exporting)}>Actualizar</button>\n",
    "            <button className=\"button secondary\" type=\"button\" onClick={reload} disabled={!examId || loading || Boolean(exporting)}>Actualizar</button>\n            <Link className=\"button secondary\" to={examId ? `/docente/evidencias?exam=${encodeURIComponent(examId)}` : '/docente/evidencias'}>Revisar evidencias</Link>\n"
)

# 7) Versión de aplicación.
for filename in ['package.json', 'package-lock.json']:
    file = ROOT / filename
    text = file.read_text(encoding='utf-8')
    text = text.replace('"version": "1.3.0"', '"version": "1.3.1"')
    file.write_text(text, encoding='utf-8')

# Eliminar el mecanismo temporal de autoparche del árbol final.
for relative in ['scripts/apply-v131-evidence-results.py', '.github/workflows/apply-v131-evidence-results.yml']:
    file = ROOT / relative
    if file.exists():
        file.unlink()

print('Patch v1.3.1 aplicado correctamente.')
