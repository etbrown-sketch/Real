(() => {
  const PRESENCE_INTERVAL_MS = 15000;
  const HOST_POLL_INTERVAL_MS = 10000;
  const STUDENT_QUESTIONS_POLL_INTERVAL_MS = 15000;

  const state = {
    caseStudy: null,
    submissionCount: 0,
    activeStudentCount: 0,
    hostPassword: '',
    activeCaseKey: null,
    completedIds: new Set(),
    interactions: [],
    hostSubmissions: [],
    hostQuestions: [],
    studentQuestions: [],
    studentPresenceId: getOrCreatePresenceId()
  };

  let presenceTimer = null;
  let hostPollTimer = null;
  let studentQuestionsPollTimer = null;

  const els = {
    studentView: document.getElementById('studentView'),
    hostView: document.getElementById('hostView'),
    viewStatusPill: document.getElementById('viewStatusPill'),
    hostViewButton: document.getElementById('hostViewButton'),
    studentViewButton: document.getElementById('studentViewButton'),
    helpButton: document.getElementById('helpButton'),
    refreshHostButton: document.getElementById('refreshHostButton'),
    refreshQuestionsButton: document.getElementById('refreshQuestionsButton'),
    waitingPanel: document.getElementById('waitingPanel'),
    studentWorkspace: document.getElementById('studentWorkspace'),
    studentAlert: document.getElementById('studentAlert'),
    hostAlert: document.getElementById('hostAlert'),
    studentProgressMetric: document.getElementById('studentProgressMetric'),
    caseTitleHeading: document.getElementById('caseTitleHeading'),
    caseFileName: document.getElementById('caseFileName'),
    caseFileMeta: document.getElementById('caseFileMeta'),
    downloadCaseButton: document.getElementById('downloadCaseButton'),
    progressLabel: document.getElementById('progressLabel'),
    progressPercent: document.getElementById('progressPercent'),
    progressFill: document.getElementById('progressFill'),
    checklistContainer: document.getElementById('checklistContainer'),
    aiForm: document.getElementById('aiForm'),
    aiInput: document.getElementById('aiInput'),
    chatWindow: document.getElementById('chatWindow'),
    submissionForm: document.getElementById('submissionForm'),
    studentName: document.getElementById('studentName'),
    studentEmail: document.getElementById('studentEmail'),
    studentCollege: document.getElementById('studentCollege'),
    expectedGraduationDate: document.getElementById('expectedGraduationDate'),
    studentMajor: document.getElementById('studentMajor'),
    resumeInternshipCount: document.getElementById('resumeInternshipCount'),
    resumeYearsExperience: document.getElementById('resumeYearsExperience'),
    resumeIndustryBreakdown: document.getElementById('resumeIndustryBreakdown'),
    submissionFile: document.getElementById('submissionFile'),
    resumeFile: document.getElementById('resumeFile'),
    submissionResult: document.getElementById('submissionResult'),
    hostLoginModal: document.getElementById('hostLoginModal'),
    hostLoginForm: document.getElementById('hostLoginForm'),
    hostPasswordInput: document.getElementById('hostPasswordInput'),
    closeLoginButton: document.getElementById('closeLoginButton'),
    publishForm: document.getElementById('publishForm'),
    caseTitle: document.getElementById('caseTitle'),
    clearSubmissions: document.getElementById('clearSubmissions'),
    addChecklistItemButton: document.getElementById('addChecklistItemButton'),
    checklistBuilder: document.getElementById('checklistBuilder'),
    hostCaseSummary: document.getElementById('hostCaseSummary'),
    submissionsTableWrap: document.getElementById('submissionsTableWrap'),
    exportCsvButton: document.getElementById('exportCsvButton'),
    resetPortalButton: document.getElementById('resetPortalButton'),
    hostQuestionsWrap: document.getElementById('hostQuestionsWrap'),
    studentHelpModal: document.getElementById('studentHelpModal'),
    closeHelpButton: document.getElementById('closeHelpButton'),
    helpQuestionForm: document.getElementById('helpQuestionForm'),
    helpStudentName: document.getElementById('helpStudentName'),
    helpStudentEmail: document.getElementById('helpStudentEmail'),
    helpQuestionText: document.getElementById('helpQuestionText'),
    helpModalAlert: document.getElementById('helpModalAlert'),
    studentQuestionsWrap: document.getElementById('studentQuestionsWrap'),
    refreshStudentQuestionsButton: document.getElementById('refreshStudentQuestionsButton'),
    submissionDashboardModal: document.getElementById('submissionDashboardModal'),
    closeDashboardButton: document.getElementById('closeDashboardButton'),
    submissionDashboardContent: document.getElementById('submissionDashboardContent')
  };

  function getOrCreatePresenceId() {
    const key = 'tffp-student-presence-id';
    let id = sessionStorage.getItem(key);
    if (!id) {
      id = window.crypto?.randomUUID ? window.crypto.randomUUID() : `student-${Date.now()}-${Math.random().toString(16).slice(2)}`;
      sessionStorage.setItem(key, id);
    }
    return id;
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function formatBytes(bytes) {
    const value = Number(bytes || 0);
    if (!value) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / Math.pow(1024, index)).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
  }

  function formatDate(iso) {
    if (!iso) return 'Not Available';
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Not Available';
    return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  function formatMonth(value) {
    const text = String(value || '').trim();
    const match = text.match(/^(\d{4})-(\d{2})$/);
    if (!match) return text || 'Not Available';
    const date = new Date(Number(match[1]), Number(match[2]) - 1, 1);
    return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }

  function formatDashboardValue(value) {
    const text = String(value ?? '').trim();
    return text || 'Review Resume Manually';
  }

  function sessionKey() {
    return state.caseStudy?.publishedAt ? `tffp-student-session:${state.caseStudy.publishedAt}` : null;
  }

  function defaultBossMessage() {
    return {
      role: 'boss',
      text: 'I am your AI Boss for the Turner Finance Futures Program. I can help you find the right source information, explain methods, plan your next step, and debug your reasoning. I will not give final answers, exact values, or complete the workbook for you.',
      timestamp: new Date().toISOString(),
      category: 'welcome'
    };
  }

  function saveStudentSession() {
    const key = sessionKey();
    if (!key) return;
    const payload = {
      studentName: els.studentName.value.trim(),
      studentEmail: els.studentEmail.value.trim(),
      studentCollege: els.studentCollege.value.trim(),
      expectedGraduationDate: els.expectedGraduationDate.value.trim(),
      studentMajor: els.studentMajor.value.trim(),
      resumeInternshipCount: els.resumeInternshipCount.value.trim(),
      resumeYearsExperience: els.resumeYearsExperience.value.trim(),
      resumeIndustryBreakdown: els.resumeIndustryBreakdown.value.trim(),
      completedIds: [...state.completedIds],
      interactions: state.interactions
    };
    localStorage.setItem(key, JSON.stringify(payload));
  }

  function resetStudentFormFields() {
    els.studentName.value = '';
    els.studentEmail.value = '';
    els.studentCollege.value = '';
    els.expectedGraduationDate.value = '';
    els.studentMajor.value = '';
    els.resumeInternshipCount.value = '';
    els.resumeYearsExperience.value = '';
    els.resumeIndustryBreakdown.value = '';
    els.submissionFile.value = '';
    els.resumeFile.value = '';
    els.submissionResult.classList.add('hidden');
    els.submissionResult.innerHTML = '';
  }

  function loadStudentSessionForCase() {
    if (!state.caseStudy) {
      state.activeCaseKey = null;
      state.completedIds = new Set();
      state.interactions = [];
      return;
    }

    const key = state.caseStudy.publishedAt;
    if (state.activeCaseKey === key) return;
    state.activeCaseKey = key;
    state.completedIds = new Set();
    state.interactions = [defaultBossMessage()];
    resetStudentFormFields();

    const stored = localStorage.getItem(sessionKey());
    if (!stored) return;

    try {
      const parsed = JSON.parse(stored);
      els.studentName.value = parsed.studentName || '';
      els.studentEmail.value = parsed.studentEmail || '';
      els.studentCollege.value = parsed.studentCollege || '';
      els.expectedGraduationDate.value = parsed.expectedGraduationDate || '';
      els.studentMajor.value = parsed.studentMajor || '';
      els.resumeInternshipCount.value = parsed.resumeInternshipCount || '';
      els.resumeYearsExperience.value = parsed.resumeYearsExperience || '';
      els.resumeIndustryBreakdown.value = parsed.resumeIndustryBreakdown || '';
      state.completedIds = new Set(Array.isArray(parsed.completedIds) ? parsed.completedIds : []);
      state.interactions = Array.isArray(parsed.interactions) && parsed.interactions.length
        ? parsed.interactions
        : [defaultBossMessage()];
    } catch {
      state.completedIds = new Set();
      state.interactions = [defaultBossMessage()];
    }
  }

  async function api(path, options = {}) {
    const { body, host = false, headers = {}, ...rest } = options;
    const request = {
      method: rest.method || 'GET',
      headers: { ...headers },
      ...rest
    };

    if (host && state.hostPassword) {
      request.headers['X-Host-Password'] = state.hostPassword;
    }

    if (body instanceof FormData) {
      request.body = body;
    } else if (body !== undefined) {
      request.headers['Content-Type'] = 'application/json';
      request.body = JSON.stringify(body);
    }

    const response = await fetch(path, request);
    const contentType = response.headers.get('content-type') || '';
    const payload = contentType.includes('application/json') ? await response.json() : await response.text();

    if (!response.ok) {
      const message = typeof payload === 'string' ? payload : payload.error || 'Request Failed.';
      throw new Error(message);
    }

    return payload;
  }

  function showAlert(element, message, type = 'info') {
    element.className = `alert ${type === 'error' ? 'error' : type === 'success' ? 'success' : ''}`.trim();
    element.textContent = message;
    element.classList.remove('hidden');
  }

  function hideAlert(element) {
    element.classList.add('hidden');
    element.textContent = '';
  }

  function progressStats() {
    const checklist = state.caseStudy?.checklist || [];
    const completed = checklist.filter((item) => state.completedIds.has(item.id)).length;
    const total = checklist.length;
    const percent = total ? Math.round((completed / total) * 100) : 0;
    return { completed, total, percent };
  }

  function renderProgress() {
    const { completed, total, percent } = progressStats();
    els.progressLabel.textContent = `${completed} Of ${total} Complete`;
    els.progressPercent.textContent = `${percent}%`;
    els.progressFill.style.width = `${percent}%`;
    els.studentProgressMetric.textContent = `${percent}%`;
  }

  function renderChecklist() {
    const checklist = state.caseStudy?.checklist || [];
    if (!checklist.length) {
      els.checklistContainer.innerHTML = '<p class="muted">No Checklist Items Published.</p>';
      renderProgress();
      return;
    }

    els.checklistContainer.innerHTML = checklist.map((item, index) => {
      const checked = state.completedIds.has(item.id) ? 'checked' : '';
      return `
        <section class="check-item-section">
          <span class="check-section-label">Checklist Item ${index + 1}</span>
          <label class="check-item">
            <input type="checkbox" data-check-id="${escapeHtml(item.id)}" ${checked}>
            <span>${escapeHtml(item.text)}</span>
          </label>
        </section>
      `;
    }).join('');
    renderProgress();
  }

  function renderChat() {
    els.chatWindow.innerHTML = state.interactions.map((entry) => {
      const isStudent = entry.role === 'student';
      const label = isStudent ? 'Student' : 'AI Boss';
      const category = isStudent && entry.category && entry.category !== 'pending'
        ? ` - ${entry.category.replace(/-/g, ' ')}`
        : '';
      return `
        <div class="chat-message ${isStudent ? 'student' : 'boss'}">
          <small>${escapeHtml(label + category)}</small>
          <div>${escapeHtml(entry.text)}</div>
        </div>
      `;
    }).join('');
    els.chatWindow.scrollTop = els.chatWindow.scrollHeight;
  }

  function renderStudent() {
    hideAlert(els.studentAlert);

    if (!state.caseStudy) {
      state.completedIds = new Set();
      state.interactions = [];
      state.activeCaseKey = null;
      els.caseTitleHeading.textContent = 'Turner Finance Futures Program';
      els.studentProgressMetric.textContent = '0%';
      els.waitingPanel.classList.remove('hidden');
      els.studentWorkspace.classList.add('hidden');
      return;
    }

    loadStudentSessionForCase();
    els.waitingPanel.classList.add('hidden');
    els.studentWorkspace.classList.remove('hidden');

    els.caseTitleHeading.textContent = state.caseStudy.title || 'Turner Finance Futures Program';
    els.caseFileName.textContent = state.caseStudy.fileName;
    els.caseFileMeta.textContent = `${formatBytes(state.caseStudy.fileSize)} - Published ${formatDate(state.caseStudy.publishedAt)}`;
    els.downloadCaseButton.href = '/api/case-file';

    renderChecklist();
    renderChat();
  }

  function renderHostCase() {
    const activeCount = Number(state.activeStudentCount || 0);
    const activeLabel = activeCount === 1 ? 'person is' : 'people are';
    const activeRow = `<div class="summary-row currently-working"><strong>Currently Working:</strong> ${activeCount} ${activeLabel} currently on the student view page.</div>`;

    if (!state.caseStudy) {
      els.hostCaseSummary.innerHTML = `
        ${activeRow}
        <div class="summary-row"><strong>Status:</strong> No Case Has Been Published.</div>
        <div class="summary-row"><strong>Student View:</strong> Waiting For Host To Begin Case Study.</div>
      `;
      return;
    }

    const checklistPreview = state.caseStudy.checklist.map((item, index) => `
      <section class="check-item-section">
        <span class="check-section-label">Checklist Item ${index + 1}</span>
        <label class="check-item">
          <input type="checkbox" disabled>
          <span>${escapeHtml(item.text)}</span>
        </label>
      </section>
    `).join('');

    els.hostCaseSummary.innerHTML = `
      ${activeRow}
      <div class="summary-row"><strong>Case Title:</strong> ${escapeHtml(state.caseStudy.title || 'Turner Finance Futures Program')}</div>
      <div class="summary-row"><strong>File:</strong> ${escapeHtml(state.caseStudy.fileName)} (${formatBytes(state.caseStudy.fileSize)})</div>
      <div class="summary-row"><strong>Published:</strong> ${formatDate(state.caseStudy.publishedAt)}</div>
      <div class="summary-row"><strong>Checklist Items:</strong> ${state.caseStudy.checklist.length}</div>
      <div class="checklist">${checklistPreview}</div>
    `;
  }

  function riskClass(risk) {
    if (risk === 'High') return 'high';
    if (risk === 'Moderate' || risk === 'Unknown') return 'medium';
    return 'low';
  }

  function gradeClass(letter) {
    return `grade-${String(letter || '').slice(0, 1).toLowerCase() || 'c'}`;
  }

  function renderSubmissions(submissions) {
    state.hostSubmissions = submissions;
    if (!submissions.length) {
      els.submissionsTableWrap.innerHTML = `
        <section class="empty-state compact-empty-state">
          <div class="empty-icon">0</div>
          <h3>No Submissions Yet.</h3>
          <p>Student submissions and AI Boss reports will appear here.</p>
        </section>
      `;
      return;
    }

    const rows = submissions.map((submission) => {
      const report = submission.report || {};
      const stats = report.stats || {};
      const grade = report.grade || {};
      const gradeLetter = grade.letter || 'N/A';
      const gradeScore = Number.isFinite(Number(grade.score)) ? Number(grade.score) : 0;
      const resumeProfile = submission.resumeProfile || {};
      const resumeCell = submission.resumeFileName
        ? `<button class="button ghost small-button" type="button" data-download-file="${escapeHtml(submission.id)}" data-file-type="resume" data-file-name="${escapeHtml(submission.resumeFileName)}">Download Resume</button><br><small>${escapeHtml(submission.resumeFileName)} (${formatBytes(submission.resumeFileSize)})</small>`
        : '<span class="muted">No Resume Attached</span>';

      return `
        <tr>
          <td>
            <button class="link-button" type="button" data-open-dashboard="${escapeHtml(submission.id)}">${escapeHtml(submission.studentName)}</button><br>
            <span>${formatDate(submission.submittedAt)}</span><br>
            <small>${escapeHtml(submission.studentEmail || 'No Email')}</small>
          </td>
          <td><span class="grade-pill ${gradeClass(gradeLetter)}">${escapeHtml(gradeLetter)} (${gradeScore})</span><br><small>${escapeHtml(grade.rationale || '')}</small></td>
          <td><span class="rating-pill ${riskClass(report.risk)}">${escapeHtml(report.rating || 'Not Rated')}</span><br><small>Risk: ${escapeHtml(report.risk || 'Unknown')}</small></td>
          <td><strong>${Number(stats.progressPercent || 0)}%</strong><br><small>${Number(stats.completedChecklistItems || 0)} Of ${Number(stats.totalChecklistItems || 0)}</small></td>
          <td>${Number(stats.answerSeekingPrompts || 0)} / ${Number(stats.totalPrompts || 0)}</td>
          <td>${escapeHtml(formatDashboardValue(resumeProfile.internshipCount))}</td>
          <td>${escapeHtml(formatDashboardValue(resumeProfile.yearsExperience))}</td>
          <td>${escapeHtml(resumeProfile.industryBreakdown || 'Review Resume Manually')}</td>
          <td>
            <button class="button ghost small-button" type="button" data-download-file="${escapeHtml(submission.id)}" data-file-type="case" data-file-name="${escapeHtml(submission.fileName)}">Download Case</button><br>
            <small>${escapeHtml(submission.fileName)} (${formatBytes(submission.fileSize)})</small>
          </td>
          <td>${resumeCell}</td>
        </tr>
      `;
    }).join('');

    els.submissionsTableWrap.innerHTML = `
      <table class="submissions-table">
        <thead>
          <tr>
            <th>Student Dashboard</th>
            <th>AI Grade</th>
            <th>AI Rating</th>
            <th>Checklist</th>
            <th>Answer-Seeking Prompts</th>
            <th>Internships</th>
            <th>Years Experience</th>
            <th>Industry Breakdown</th>
            <th>Case File</th>
            <th>Resume</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
    `;
  }

  function renderSubmissionDashboard(submission) {
    const report = submission.report || {};
    const stats = report.stats || {};
    const grade = report.grade || {};
    const resumeProfile = submission.resumeProfile || {};
    const dashboardHtml = `
      <p class="eyebrow copper">Candidate Dashboard</p>
      <h2 id="submissionDashboardTitle">${escapeHtml(submission.studentName)}</h2>
      <p class="modal-note">Submitted ${formatDate(submission.submittedAt)}.</p>

      <div class="dashboard-grid">
        <section class="dashboard-section">
          <h3>Candidate Information</h3>
          <dl class="dashboard-list">
            <div><dt>College</dt><dd>${escapeHtml(submission.college || 'Not Provided')}</dd></div>
            <div><dt>Expected Graduation Date</dt><dd>${escapeHtml(formatMonth(submission.expectedGraduationDate))}</dd></div>
            <div><dt>Major</dt><dd>${escapeHtml(submission.major || 'Not Provided')}</dd></div>
            <div><dt>Email Address</dt><dd><a href="mailto:${escapeHtml(submission.studentEmail || '')}">${escapeHtml(submission.studentEmail || 'Not Provided')}</a></dd></div>
          </dl>
        </section>

        <section class="dashboard-section">
          <h3>Resume Dashboard</h3>
          <dl class="dashboard-list">
            <div><dt>Number Of Internships On Resume</dt><dd>${escapeHtml(formatDashboardValue(resumeProfile.internshipCount))}</dd></div>
            <div><dt>Years Of Experience On Resume</dt><dd>${escapeHtml(formatDashboardValue(resumeProfile.yearsExperience))}</dd></div>
            <div><dt>Industry Experience Breakdown</dt><dd>${escapeHtml(resumeProfile.industryBreakdown || 'Review Resume Manually')}</dd></div>
            <div><dt>Resume Insight Note</dt><dd>${escapeHtml(resumeProfile.confidenceNote || 'Review resume manually before making final decisions.')}</dd></div>
          </dl>
        </section>

        <section class="dashboard-section">
          <h3>AI Boss Performance</h3>
          <dl class="dashboard-list">
            <div><dt>AI Grade</dt><dd><span class="grade-pill ${gradeClass(grade.letter)}">${escapeHtml(grade.letter || 'N/A')} (${Number(grade.score || 0)})</span></dd></div>
            <div><dt>AI Rating</dt><dd><span class="rating-pill ${riskClass(report.risk)}">${escapeHtml(report.rating || 'Not Rated')}</span></dd></div>
            <div><dt>Checklist Progress</dt><dd>${Number(stats.progressPercent || 0)}% (${Number(stats.completedChecklistItems || 0)} Of ${Number(stats.totalChecklistItems || 0)})</dd></div>
            <div><dt>Answer-Seeking Prompts</dt><dd>${Number(stats.answerSeekingPrompts || 0)} Of ${Number(stats.totalPrompts || 0)}</dd></div>
            <div><dt>Productive Coaching Prompts</dt><dd>${Number(stats.productiveCoachingPrompts || 0)}</dd></div>
          </dl>
        </section>

        <section class="dashboard-section">
          <h3>Host Review Notes</h3>
          <p><strong>Summary:</strong> ${escapeHtml(report.pattern || 'No Summary Available.')}</p>
          <p><strong>Recommended Follow-Up:</strong> ${escapeHtml(report.hostFollowUp || 'Review The Workbook Directly.')}</p>
          <p><strong>Grade Note:</strong> ${escapeHtml(grade.confidenceNote || '')}</p>
        </section>
      </div>

      <div class="dashboard-actions">
        <button class="button ghost" type="button" data-download-file="${escapeHtml(submission.id)}" data-file-type="case" data-file-name="${escapeHtml(submission.fileName)}">Download Case</button>
        ${submission.resumeFileName ? `<button class="button ghost" type="button" data-download-file="${escapeHtml(submission.id)}" data-file-type="resume" data-file-name="${escapeHtml(submission.resumeFileName)}">Download Resume</button>` : ''}
      </div>
    `;
    els.submissionDashboardContent.innerHTML = dashboardHtml;
    els.submissionDashboardModal.classList.remove('hidden');
  }

  function closeSubmissionDashboard() {
    els.submissionDashboardModal.classList.add('hidden');
  }

  function renderHostQuestions(questions) {
    state.hostQuestions = questions;
    if (!questions.length) {
      els.hostQuestionsWrap.innerHTML = `
        <section class="empty-state compact-empty-state">
          <div class="empty-icon">?</div>
          <h3>No Student Questions Yet.</h3>
          <p>Questions sent from the Help button will appear here.</p>
        </section>
      `;
      return;
    }

    els.hostQuestionsWrap.innerHTML = questions.map((question) => {
      const answered = question.status === 'Answered' && question.answer;
      return `
        <section class="question-card ${answered ? 'answered' : ''}" data-question-card="${escapeHtml(question.id)}">
          <div class="question-topline">
            <div>
              <h4>${escapeHtml(question.studentName || 'Student')}</h4>
              <p>${escapeHtml(question.studentEmail || 'No Email')} - Asked ${formatDate(question.createdAt)}</p>
            </div>
            <span class="status-tag ${answered ? 'answered' : 'open'}">${answered ? 'Answered' : 'Open'}</span>
          </div>
          <p class="question-text">${escapeHtml(question.question)}</p>
          ${answered ? `<div class="posted-answer"><strong>Posted Answer:</strong> ${escapeHtml(question.answer)}<br><small>Posted ${formatDate(question.answeredAt)}</small></div>` : ''}
          <label>
            Host Answer
            <textarea rows="3" data-answer-input placeholder="Type an answer to post on this student's page.">${answered ? escapeHtml(question.answer) : ''}</textarea>
          </label>
          <button class="button primary small-button" type="button" data-post-answer="${escapeHtml(question.id)}">Post Answer</button>
        </section>
      `;
    }).join('');
  }

  function renderStudentQuestions(questions) {
    state.studentQuestions = questions;
    if (!questions.length) {
      els.studentQuestionsWrap.innerHTML = '<p class="muted">No Questions Sent Yet.</p>';
      return;
    }

    els.studentQuestionsWrap.innerHTML = questions.map((question) => {
      const answered = question.status === 'Answered' && question.answer;
      return `
        <section class="question-card ${answered ? 'answered' : ''}">
          <div class="question-topline">
            <div>
              <h4>Your Question</h4>
              <p>Sent ${formatDate(question.createdAt)}</p>
            </div>
            <span class="status-tag ${answered ? 'answered' : 'open'}">${answered ? 'Answered' : 'Waiting For Host'}</span>
          </div>
          <p class="question-text">${escapeHtml(question.question)}</p>
          ${answered ? `<div class="posted-answer"><strong>Host Answer:</strong> ${escapeHtml(question.answer)}<br><small>Posted ${formatDate(question.answeredAt)}</small></div>` : '<p class="muted">The host has not posted an answer yet.</p>'}
        </section>
      `;
    }).join('');
  }

  async function loadStatus() {
    const data = await api('/api/status');
    state.caseStudy = data.caseStudy;
    state.submissionCount = data.submissionCount || 0;
    state.activeStudentCount = data.activeStudentCount || 0;
    renderStudent();
    renderHostCase();
  }

  async function loadHostSubmissions() {
    if (!state.hostPassword) return;
    const data = await api('/api/host/submissions', { host: true });
    renderSubmissions(data.submissions || []);
  }

  async function loadHostQuestions() {
    if (!state.hostPassword) return;
    const data = await api('/api/host/questions', { host: true });
    renderHostQuestions(data.questions || []);
  }

  async function loadStudentQuestions() {
    if (!state.caseStudy) {
      renderStudentQuestions([]);
      return;
    }
    const data = await api(`/api/help/questions?sessionId=${encodeURIComponent(state.studentPresenceId)}`);
    renderStudentQuestions(data.questions || []);
  }

  function isStudentViewVisible() {
    return !els.studentView.classList.contains('hidden');
  }

  async function sendPresence(active) {
    try {
      const data = await api('/api/student-presence', {
        method: 'POST',
        body: {
          sessionId: state.studentPresenceId,
          active: Boolean(active)
        }
      });
      state.activeStudentCount = data.activeStudentCount || 0;
      renderHostCase();
    } catch {
      // Presence updates should not interrupt student or host workflows.
    }
  }

  function startPresence() {
    window.clearInterval(presenceTimer);
    if (!isStudentViewVisible() || document.hidden) return;
    sendPresence(true);
    presenceTimer = window.setInterval(() => {
      if (isStudentViewVisible() && !document.hidden) sendPresence(true);
    }, PRESENCE_INTERVAL_MS);
  }

  async function stopPresence() {
    window.clearInterval(presenceTimer);
    presenceTimer = null;
    await sendPresence(false);
  }

  function startHostPolling() {
    window.clearInterval(hostPollTimer);
    hostPollTimer = window.setInterval(() => {
      if (!els.hostView.classList.contains('hidden') && state.hostPassword) {
        Promise.all([loadStatus(), loadHostSubmissions(), loadHostQuestions()])
          .catch((error) => showAlert(els.hostAlert, error.message, 'error'));
      }
    }, HOST_POLL_INTERVAL_MS);
  }

  function stopHostPolling() {
    window.clearInterval(hostPollTimer);
    hostPollTimer = null;
  }

  function startStudentQuestionsPolling() {
    window.clearInterval(studentQuestionsPollTimer);
    if (!isStudentViewVisible() || document.hidden) return;
    loadStudentQuestions().catch(() => {});
    studentQuestionsPollTimer = window.setInterval(() => {
      if (isStudentViewVisible() && !document.hidden && state.caseStudy) loadStudentQuestions().catch(() => {});
    }, STUDENT_QUESTIONS_POLL_INTERVAL_MS);
  }

  function stopStudentQuestionsPolling() {
    window.clearInterval(studentQuestionsPollTimer);
    studentQuestionsPollTimer = null;
  }

  async function switchToStudent() {
    stopHostPolling();
    els.hostView.classList.add('hidden');
    els.studentView.classList.remove('hidden');
    els.hostViewButton.classList.remove('hidden');
    els.helpButton.classList.remove('hidden');
    els.viewStatusPill.textContent = 'Student View';
    hideAlert(els.hostAlert);
    try {
      await loadStatus();
      startPresence();
      startStudentQuestionsPolling();
    } catch (error) {
      showAlert(els.studentAlert, error.message, 'error');
    }
  }

  async function switchToHost() {
    await stopPresence();
    stopStudentQuestionsPolling();
    els.studentView.classList.add('hidden');
    els.hostView.classList.remove('hidden');
    els.hostViewButton.classList.add('hidden');
    els.helpButton.classList.add('hidden');
    els.viewStatusPill.textContent = 'Host View';
    hideAlert(els.studentAlert);
    await loadStatus();
    await loadHostSubmissions();
    await loadHostQuestions();
    startHostPolling();
  }

  function openLoginModal() {
    els.hostLoginModal.classList.remove('hidden');
    els.hostPasswordInput.value = '';
    window.setTimeout(() => els.hostPasswordInput.focus(), 0);
  }

  function closeLoginModal() {
    els.hostLoginModal.classList.add('hidden');
  }

  async function handleHostLogin(event) {
    event.preventDefault();
    const password = els.hostPasswordInput.value;
    const button = els.hostLoginForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/host/login', { method: 'POST', body: { password } });
      state.hostPassword = password;
      closeLoginModal();
      await switchToHost();
    } catch (error) {
      showAlert(els.studentAlert, error.message, 'error');
      els.hostPasswordInput.select();
    } finally {
      button.disabled = false;
    }
  }

  function openHelpModal() {
    hideAlert(els.helpModalAlert);
    els.helpStudentName.value = els.studentName.value.trim();
    els.helpStudentEmail.value = els.studentEmail.value.trim();
    els.studentHelpModal.classList.remove('hidden');
    loadStudentQuestions().catch((error) => showAlert(els.helpModalAlert, error.message, 'error'));
    window.setTimeout(() => {
      if (!els.helpStudentName.value) els.helpStudentName.focus();
      else if (!els.helpStudentEmail.value) els.helpStudentEmail.focus();
      else els.helpQuestionText.focus();
    }, 0);
  }

  function closeHelpModal() {
    els.studentHelpModal.classList.add('hidden');
  }

  async function handleHelpQuestion(event) {
    event.preventDefault();
    hideAlert(els.helpModalAlert);
    if (!state.caseStudy) return showAlert(els.helpModalAlert, 'Waiting For Host To Begin Case Study.', 'error');

    const studentName = els.helpStudentName.value.trim();
    const studentEmail = els.helpStudentEmail.value.trim();
    const question = els.helpQuestionText.value.trim();
    if (!studentName || !studentEmail || !question) return showAlert(els.helpModalAlert, 'Enter your name, email address, and question.', 'error');

    const button = els.helpQuestionForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      const data = await api('/api/help/questions', {
        method: 'POST',
        body: {
          sessionId: state.studentPresenceId,
          studentName,
          studentEmail,
          question
        }
      });
      els.studentName.value = els.studentName.value.trim() || studentName;
      els.studentEmail.value = els.studentEmail.value.trim() || studentEmail;
      els.helpQuestionText.value = '';
      showAlert(els.helpModalAlert, 'Question Sent. The host answer will appear in this Help window.', 'success');
      renderStudentQuestions([data.question, ...state.studentQuestions]);
      saveStudentSession();
    } catch (error) {
      showAlert(els.helpModalAlert, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function addChecklistBuilderItem(value = '') {
    const index = els.checklistBuilder.children.length + 1;
    const section = document.createElement('section');
    section.className = 'checklist-builder-item';
    section.innerHTML = `
      <div class="item-topline">
        <strong>Checklist Section ${index}</strong>
        <button class="icon-button" type="button" aria-label="Remove Checklist Section" data-remove-checklist-item>x</button>
      </div>
      <label>
        Instruction
        <textarea rows="3" data-checklist-input placeholder="Example: Complete the forecast schedule and verify formulas across all periods."></textarea>
      </label>
    `;
    const textarea = section.querySelector('[data-checklist-input]');
    textarea.value = value;
    els.checklistBuilder.appendChild(section);
    updateChecklistBuilderNumbers();
    textarea.focus();
  }

  function updateChecklistBuilderNumbers() {
    const sections = [...els.checklistBuilder.querySelectorAll('.checklist-builder-item')];
    sections.forEach((section, index) => {
      const title = section.querySelector('.item-topline strong');
      const removeButton = section.querySelector('[data-remove-checklist-item]');
      title.textContent = `Checklist Section ${index + 1}`;
      removeButton.disabled = sections.length === 1;
      removeButton.title = sections.length === 1 ? 'At least one checklist section is required.' : 'Remove This Checklist Section.';
    });
  }

  function resetChecklistBuilder() {
    els.checklistBuilder.innerHTML = '';
    addChecklistBuilderItem('');
  }

  function getChecklistBuilderValues() {
    return [...els.checklistBuilder.querySelectorAll('[data-checklist-input]')]
      .map((input) => input.value.trim())
      .filter(Boolean);
  }

  function handleChecklistBuilderClick(event) {
    const button = event.target.closest('[data-remove-checklist-item]');
    if (!button) return;
    const sections = els.checklistBuilder.querySelectorAll('.checklist-builder-item');
    if (sections.length <= 1) return;
    button.closest('.checklist-builder-item').remove();
    updateChecklistBuilderNumbers();
  }

  async function handlePublish(event) {
    event.preventDefault();
    hideAlert(els.hostAlert);

    const checklistItems = getChecklistBuilderValues();
    if (!els.caseTitle.value.trim()) {
      showAlert(els.hostAlert, 'Add a Case Title before publishing.', 'error');
      return;
    }
    if (!checklistItems.length) {
      showAlert(els.hostAlert, 'Add at least one checklist section before publishing.', 'error');
      return;
    }

    const formData = new FormData(els.publishForm);
    formData.append('checklistItems', JSON.stringify(checklistItems));
    formData.append('clearSubmissions', els.clearSubmissions.checked ? 'true' : 'false');
    const button = els.publishForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/host/publish', { method: 'POST', body: formData, host: true });
      showAlert(els.hostAlert, 'Case Study Published. Student View Has Been Updated.', 'success');
      els.publishForm.reset();
      resetChecklistBuilder();
      await loadStatus();
      await loadHostSubmissions();
      await loadHostQuestions();
    } catch (error) {
      showAlert(els.hostAlert, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function handleAiQuestion(event) {
    event.preventDefault();
    hideAlert(els.studentAlert);
    if (!state.caseStudy) return showAlert(els.studentAlert, 'Waiting For Host To Begin Case Study.', 'error');
    const message = els.aiInput.value.trim();
    if (!message) return;

    const button = els.aiForm.querySelector('button[type="submit"]');
    const studentEntry = {
      role: 'student',
      text: message,
      timestamp: new Date().toISOString(),
      category: 'pending'
    };
    state.interactions.push(studentEntry);
    els.aiInput.value = '';
    renderChat();
    saveStudentSession();
    button.disabled = true;

    try {
      const result = await api('/api/ai-boss', {
        method: 'POST',
        body: {
          message,
          completedIds: [...state.completedIds]
        }
      });
      studentEntry.category = result.category;
      state.interactions.push({
        role: 'boss',
        text: result.reply,
        timestamp: new Date().toISOString(),
        category: result.category
      });
    } catch (error) {
      studentEntry.category = 'error';
      state.interactions.push({
        role: 'boss',
        text: `I could not respond because: ${error.message}`,
        timestamp: new Date().toISOString(),
        category: 'error'
      });
    } finally {
      renderChat();
      saveStudentSession();
      button.disabled = false;
      els.aiInput.focus();
    }
  }

  function renderSubmissionResult() {
    els.submissionResult.innerHTML = `
      <h4>Submission Received</h4>
      <p>Your completed case study document and resume were sent to the host.</p>
    `;
    els.submissionResult.classList.remove('hidden');
  }

  async function handleSubmission(event) {
    event.preventDefault();
    hideAlert(els.studentAlert);
    if (!state.caseStudy) return showAlert(els.studentAlert, 'Waiting For Host To Begin Case Study.', 'error');

    const { percent } = progressStats();
    if (percent < 100) {
      const proceed = window.confirm(`Your checklist is ${percent}% complete. Submit anyway?`);
      if (!proceed) return;
    }

    const caseFile = els.submissionFile.files[0];
    const resumeFile = els.resumeFile.files[0];
    if (!els.studentEmail.value.trim()) return showAlert(els.studentAlert, 'Enter your email address before submitting.', 'error');
    if (!els.studentCollege.value.trim()) return showAlert(els.studentAlert, 'Enter your college before submitting.', 'error');
    if (!els.expectedGraduationDate.value.trim()) return showAlert(els.studentAlert, 'Enter your expected graduation date before submitting.', 'error');
    if (!els.studentMajor.value.trim()) return showAlert(els.studentAlert, 'Enter your major before submitting.', 'error');
    if (!caseFile) return showAlert(els.studentAlert, 'Upload Your Completed Case Study Document.', 'error');
    if (!resumeFile) return showAlert(els.studentAlert, 'Attach Your Resume Before Submitting.', 'error');

    const formData = new FormData();
    formData.append('studentName', els.studentName.value.trim());
    formData.append('studentEmail', els.studentEmail.value.trim());
    formData.append('studentCollege', els.studentCollege.value.trim());
    formData.append('expectedGraduationDate', els.expectedGraduationDate.value.trim());
    formData.append('studentMajor', els.studentMajor.value.trim());
    formData.append('resumeInternshipCount', els.resumeInternshipCount.value.trim());
    formData.append('resumeYearsExperience', els.resumeYearsExperience.value.trim());
    formData.append('resumeIndustryBreakdown', els.resumeIndustryBreakdown.value.trim());
    formData.append('submissionFile', caseFile);
    formData.append('resumeFile', resumeFile);
    formData.append('completedIds', JSON.stringify([...state.completedIds]));
    formData.append('interactions', JSON.stringify(state.interactions));

    const button = els.submissionForm.querySelector('button[type="submit"]');
    button.disabled = true;
    try {
      await api('/api/submissions', { method: 'POST', body: formData });
      renderSubmissionResult();
      showAlert(els.studentAlert, 'Submitted Successfully. Your resume and completed case study were sent to the host.', 'success');
      saveStudentSession();
    } catch (error) {
      showAlert(els.studentAlert, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  function handleChecklistClick(event) {
    const input = event.target.closest('input[data-check-id]');
    if (!input) return;
    const id = input.getAttribute('data-check-id');
    if (input.checked) state.completedIds.add(id);
    else state.completedIds.delete(id);
    renderProgress();
    saveStudentSession();
  }

  function handlePromptChip(event) {
    const button = event.target.closest('button[data-prompt]');
    if (!button) return;
    els.aiInput.value = button.getAttribute('data-prompt');
    els.aiForm.requestSubmit();
  }

  async function downloadFile(id, fileName, fileType) {
    const endpoint = fileType === 'resume' ? 'resume-file' : 'submission-file';
    const response = await fetch(`/api/${endpoint}/${encodeURIComponent(id)}`, {
      headers: { 'X-Host-Password': state.hostPassword }
    });
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = fileName || fileType || 'download';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  async function handleDownloadButton(button) {
    hideAlert(els.hostAlert);
    button.disabled = true;
    try {
      await downloadFile(
        button.getAttribute('data-download-file'),
        button.getAttribute('data-file-name'),
        button.getAttribute('data-file-type')
      );
    } catch (error) {
      showAlert(els.hostAlert, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function handleSubmissionTableClick(event) {
    const dashboardButton = event.target.closest('[data-open-dashboard]');
    if (dashboardButton) {
      const id = dashboardButton.getAttribute('data-open-dashboard');
      const submission = state.hostSubmissions.find((item) => item.id === id);
      if (submission) renderSubmissionDashboard(submission);
      return;
    }

    const downloadButton = event.target.closest('button[data-download-file]');
    if (downloadButton) await handleDownloadButton(downloadButton);
  }

  async function handleDashboardClick(event) {
    const downloadButton = event.target.closest('button[data-download-file]');
    if (downloadButton) await handleDownloadButton(downloadButton);
  }

  async function handleHostQuestionClick(event) {
    const button = event.target.closest('[data-post-answer]');
    if (!button) return;
    hideAlert(els.hostAlert);
    const id = button.getAttribute('data-post-answer');
    const card = button.closest('[data-question-card]');
    const textarea = card?.querySelector('[data-answer-input]');
    const answer = textarea?.value.trim() || '';
    if (!answer) return showAlert(els.hostAlert, 'Enter an answer before posting.', 'error');

    button.disabled = true;
    try {
      await api(`/api/host/questions/${encodeURIComponent(id)}/answer`, {
        method: 'POST',
        body: { answer },
        host: true
      });
      showAlert(els.hostAlert, 'Answer Posted To The Student Page.', 'success');
      await loadHostQuestions();
    } catch (error) {
      showAlert(els.hostAlert, error.message, 'error');
    } finally {
      button.disabled = false;
    }
  }

  async function exportCsv() {
    hideAlert(els.hostAlert);
    const response = await fetch('/api/host/export.csv', {
      headers: { 'X-Host-Password': state.hostPassword }
    });
    if (!response.ok) throw new Error(await response.text());
    const blob = await response.blob();
    const objectUrl = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = objectUrl;
    link.download = 'turner-finance-futures-submissions.csv';
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(objectUrl);
  }

  async function resetPortal() {
    hideAlert(els.hostAlert);
    const proceed = window.confirm('Reset all portal data, including the published case, help questions, and every submission?');
    if (!proceed) return;
    try {
      await api('/api/host/reset', { method: 'POST', body: {}, host: true });
      Object.keys(localStorage).forEach((key) => {
        if (key.startsWith('tffp-student-session:')) localStorage.removeItem(key);
      });
      state.activeCaseKey = null;
      showAlert(els.hostAlert, 'Portal Data Reset. Student View Now Shows The Waiting Message.', 'success');
      await loadStatus();
      renderSubmissions([]);
      renderHostQuestions([]);
    } catch (error) {
      showAlert(els.hostAlert, error.message, 'error');
    }
  }

  function bindEvents() {
    els.hostViewButton.addEventListener('click', openLoginModal);
    els.helpButton.addEventListener('click', openHelpModal);
    els.closeLoginButton.addEventListener('click', closeLoginModal);
    els.hostLoginModal.addEventListener('click', (event) => {
      if (event.target === els.hostLoginModal) closeLoginModal();
    });
    els.closeHelpButton.addEventListener('click', closeHelpModal);
    els.studentHelpModal.addEventListener('click', (event) => {
      if (event.target === els.studentHelpModal) closeHelpModal();
    });
    els.closeDashboardButton.addEventListener('click', closeSubmissionDashboard);
    els.submissionDashboardModal.addEventListener('click', (event) => {
      if (event.target === els.submissionDashboardModal) closeSubmissionDashboard();
    });
    els.hostLoginForm.addEventListener('submit', handleHostLogin);
    els.studentViewButton.addEventListener('click', () => switchToStudent());
    els.refreshHostButton.addEventListener('click', () => switchToHost().catch((error) => showAlert(els.hostAlert, error.message, 'error')));
    els.refreshQuestionsButton.addEventListener('click', () => loadHostQuestions().catch((error) => showAlert(els.hostAlert, error.message, 'error')));
    els.publishForm.addEventListener('submit', handlePublish);
    els.addChecklistItemButton.addEventListener('click', () => addChecklistBuilderItem(''));
    els.checklistBuilder.addEventListener('click', handleChecklistBuilderClick);
    els.aiForm.addEventListener('submit', handleAiQuestion);
    document.querySelector('.prompt-chips').addEventListener('click', handlePromptChip);
    els.checklistContainer.addEventListener('change', handleChecklistClick);
    els.submissionForm.addEventListener('submit', handleSubmission);
    els.helpQuestionForm.addEventListener('submit', handleHelpQuestion);
    els.refreshStudentQuestionsButton.addEventListener('click', () => loadStudentQuestions().catch((error) => showAlert(els.helpModalAlert, error.message, 'error')));
    [els.studentName, els.studentEmail, els.studentCollege, els.expectedGraduationDate, els.studentMajor, els.resumeInternshipCount, els.resumeYearsExperience, els.resumeIndustryBreakdown].forEach((element) => {
      element.addEventListener('input', saveStudentSession);
    });
    els.submissionsTableWrap.addEventListener('click', (event) => {
      handleSubmissionTableClick(event).catch((error) => showAlert(els.hostAlert, error.message, 'error'));
    });
    els.submissionDashboardContent.addEventListener('click', (event) => {
      handleDashboardClick(event).catch((error) => showAlert(els.hostAlert, error.message, 'error'));
    });
    els.hostQuestionsWrap.addEventListener('click', (event) => {
      handleHostQuestionClick(event).catch((error) => showAlert(els.hostAlert, error.message, 'error'));
    });
    els.exportCsvButton.addEventListener('click', () => exportCsv().catch((error) => showAlert(els.hostAlert, error.message, 'error')));
    els.resetPortalButton.addEventListener('click', resetPortal);

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        stopPresence();
        stopStudentQuestionsPolling();
      } else if (isStudentViewVisible()) {
        startPresence();
        startStudentQuestionsPolling();
      }
    });

    window.addEventListener('beforeunload', () => {
      const body = JSON.stringify({ sessionId: state.studentPresenceId, active: false });
      if (navigator.sendBeacon) {
        navigator.sendBeacon('/api/student-presence', new Blob([body], { type: 'application/json' }));
      }
    });
  }

  async function init() {
    resetChecklistBuilder();
    bindEvents();
    try {
      await loadStatus();
      startPresence();
      startStudentQuestionsPolling();
    } catch (error) {
      showAlert(els.studentAlert, error.message, 'error');
    }
  }

  init();
})();
