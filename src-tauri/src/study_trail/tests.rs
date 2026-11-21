#[cfg(test)]
mod tests {
    use crate::models::study_plan::{MaterialSupport, PlanPrerequisite, StudyPlanVersionNode};
    use crate::models::study_trail::{
        AssessmentEligibilityPolicy, ObjectiveCoverageStatus, SegmentReadinessStatus,
        StructuralClass, StudyTrailItemStatus,
    };
    use crate::study_trail::content_classifier::{classify_structural_unit, ClassificationContext};
    use crate::study_trail::eligibility::evaluate_assessment_eligibility;
    use crate::study_trail::planner::{plan_study_trail, topological_concept_order};
    use crate::study_trail::retrieval_pipeline::{
        retrieve_segments_for_objective, DocumentSourceForTrail, ObjectiveQuery,
    };
    use crate::study_trail::structural_analyzer::{
        analyze_document_structure, StructuralSourceInput, TranscriptUnitInput,
    };

    fn make_query(objective: &str, node_title: &str) -> ObjectiveQuery {
        ObjectiveQuery {
            plan_id: "plan-1".to_string(),
            version_id: "ver-1".to_string(),
            node_id: "node-1".to_string(),
            node_title: node_title.to_string(),
            objective_index: 0,
            objective_text: objective.to_string(),
            context: ClassificationContext::from_objective_text(objective),
            ..Default::default()
        }
    }

    #[test]
    fn excludes_epub_toc_and_selects_explanatory_chapter() {
        let toc_html = "<h1>Table of Contents</h1><p>Chapter 1: Appearance and Reality .... 12</p><p>Chapter 2: Knowledge by Acquaintance .... 28</p><p>Chapter 3: Induction .... 44</p>";
        let ch1_html = "<h1>Chapter 1: Appearance and Reality</h1><p>Philosophers distinguish between how things appear to our senses and what they are in reality. For example, a table looks brown under normal light, yet appears shiny white under a bright lamp. Therefore, the colour is not an intrinsic property of the table itself, because different observers perceive different appearances depending on their position and lighting.</p>";

        let units = analyze_document_structure(StructuralSourceInput::EpubSpines {
            document_id: "doc-epub",
            spines: &[(0, toc_html.to_string()), (1, ch1_html.to_string())],
        });
        assert_eq!(classify_structural_unit(&units[0]), StructuralClass::Toc);

        let src = DocumentSourceForTrail {
            document_id: "doc-epub".to_string(),
            document_title: "Problems of Philosophy".to_string(),
            document_revision: "rev-1".to_string(),
            format: "epub".to_string(),
            is_ai_excluded: false,
            readiness: SegmentReadinessStatus::Ready,
            units,
            total_length_hint: 500,
        };
        let res = retrieve_segments_for_objective(
            &[src],
            &make_query("Understand the distinction between appearance and reality", "Appearance and Reality"),
            "2026-11-17T00:00:00Z",
        );
        assert_eq!(res.coverage_status, ObjectiveCoverageStatus::AdequatelyCovered);
        assert_eq!(res.segments.len(), 1);
        assert!(res.segments[0].excerpt_preview.contains("table looks brown"));
    }

    #[test]
    fn sparse_pdf_units_keep_their_physical_page_numbers() {
        let units = analyze_document_structure(StructuralSourceInput::PdfLocatedPages {
            document_id: "pdf-sparse",
            pages: &[
                (1, "First physical page".into()),
                (3, "Third physical page".into()),
            ],
        });
        assert_eq!(
            units
                .iter()
                .map(|unit| unit.page_number)
                .collect::<Vec<_>>(),
            [Some(1), Some(3)]
        );
    }

    #[test]
    fn excludes_pdf_front_matter_bibliography_index_and_running_headers() {
        let pages = vec![
            "Philosophy Press\nCopyright © 2024 Philosophy Press\nAll rights reserved. ISBN 978-0-123456-78-9\nLibrary of Congress Cataloging-in-Publication Data".to_string(),
            "Running Header: Epistemology\nChapter 1\n1".to_string(),
            "Running Header: Epistemology\nChapter 2\nJustified true belief is defined as a tripartite analysis of knowledge. A subject knows a proposition because it is true, the subject believes it, and the subject has adequate justification. For example, suppose that a reliable clock shows the right time.\n2".to_string(),
            "Running Header: Epistemology\nBibliography\nGettier, E. (1963). Is Justified True Belief Knowledge? Analysis, pp. 121-123.\nRussell, B. (1912). The Problems of Philosophy. Oxford University Press.\nGoldman, A. (1979). What is Justified Belief? University Press.\n3".to_string(),
            "Running Header: Epistemology\nIndex\nAppearance, 12, 14\nBelief, 22, 45\nEpistemology, 1, 18\nJustified true belief, 22, 23\n4".to_string(),
        ];

        let units = analyze_document_structure(StructuralSourceInput::PdfPages {
            document_id: "doc-pdf",
            pages: &pages,
        });
        let src = DocumentSourceForTrail {
            document_id: "doc-pdf".to_string(),
            document_title: "Epistemology Primer".to_string(),
            document_revision: "rev-pdf".to_string(),
            format: "pdf".to_string(),
            is_ai_excluded: false,
            readiness: SegmentReadinessStatus::Ready,
            units,
            total_length_hint: 1000,
        };
        let res = retrieve_segments_for_objective(
            &[src],
            &make_query("Explain justified true belief", "Justified True Belief"),
            "2026-11-17T00:00:00Z",
        );
        assert_eq!(res.coverage_status, ObjectiveCoverageStatus::AdequatelyCovered);
        assert_eq!(res.segments.len(), 1);
        assert_eq!(res.segments[0].start_locator["pageNumber"], 3);
        assert!(!res.segments[0].excerpt_preview.contains("Gettier, E. (1963)"));
    }

    #[test]
    fn contextual_exception_allows_bibliography_for_research_methods() {
        let md = "# Bibliography\n\nSmith, J. (2020). Research Methods in Philosophy. Oxford University Press.\nDoe, A. (2021). Citation Style Guide, pp. 12-40.\nLee, K. (2022). Literature Review Techniques. University Press.\n";
        let units = analyze_document_structure(StructuralSourceInput::Markdown {
            document_id: "doc-bib",
            text: md,
        });
        assert_eq!(classify_structural_unit(&units[0]), StructuralClass::Bibliography);

        let ctx = ClassificationContext::from_objective_text("Analyze citation style in a bibliography");
        assert!(ctx.is_permitted(StructuralClass::Bibliography));
    }

    #[test]
    fn rejects_keyword_only_incidental_mention_and_returns_no_match() {
        let md = "# Notes\n\nSee Chapter 9 on justified true belief.\n\n# Unrelated\n\nGardening requires sunlight and water every morning. Soil quality determines how well roots absorb nutrients across seasons.\n";
        let units = analyze_document_structure(StructuralSourceInput::Markdown {
            document_id: "doc-incidental",
            text: md,
        });
        let src = DocumentSourceForTrail {
            document_id: "doc-incidental".to_string(),
            document_title: "Notes".to_string(),
            document_revision: "rev-1".to_string(),
            format: "markdown".to_string(),
            is_ai_excluded: false,
            readiness: SegmentReadinessStatus::Ready,
            units,
            total_length_hint: 200,
        };
        let res = retrieve_segments_for_objective(
            &[src],
            &make_query("Explain justified true belief", "Justified True Belief"),
            "2026-11-17T00:00:00Z",
        );
        assert_eq!(res.coverage_status, ObjectiveCoverageStatus::NoMatch);
        assert!(res.segments.is_empty());
    }

    #[test]
    fn discovers_relevant_section_deep_in_long_document() {
        let mut md = String::new();
        for i in 1..=40 {
            md.push_str(&format!(
                "# Chapter {}: Botany\n\nPlants convert sunlight into chemical energy through photosynthesis in chloroplasts. Chlorophyll absorbs blue and red wavelengths while reflecting green light. Water and carbon dioxide react to form glucose and oxygen.\n\n",
                i
            ));
        }
        md.push_str("# Chapter 41: Epistemic Justification\n\nEpistemic justification is defined as the normative standing a belief has when supported by good reasons or reliable evidence. Therefore, a lucky guess is not justified even if it happens to be true, because the believer lacks an appropriate evidential basis.\n");

        let units = analyze_document_structure(StructuralSourceInput::Markdown {
            document_id: "doc-long",
            text: &md,
        });
        let src = DocumentSourceForTrail {
            document_id: "doc-long".to_string(),
            document_title: "Long Treatise".to_string(),
            document_revision: "rev-long".to_string(),
            format: "markdown".to_string(),
            is_ai_excluded: false,
            readiness: SegmentReadinessStatus::Ready,
            units,
            total_length_hint: md.len(),
        };
        let res = retrieve_segments_for_objective(
            &[src],
            &make_query("Define epistemic justification", "Epistemic Justification"),
            "2026-11-17T00:00:00Z",
        );
        assert_eq!(res.coverage_status, ObjectiveCoverageStatus::AdequatelyCovered);
        assert_eq!(res.segments[0].title, "Chapter 41: Epistemic Justification");
    }

    #[test]
    fn reports_needs_ocr_scanned_pdf_as_source_unavailable() {
        let src = DocumentSourceForTrail {
            document_id: "doc-scan".to_string(),
            document_title: "Scanned Book".to_string(),
            document_revision: "rev-scan".to_string(),
            format: "pdf".to_string(),
            is_ai_excluded: false,
            readiness: SegmentReadinessStatus::NeedsOcr,
            units: vec![],
            total_length_hint: 0,
        };
        let res = retrieve_segments_for_objective(
            &[src],
            &make_query("Explain induction", "Induction"),
            "2026-11-17T00:00:00Z",
        );
        assert_eq!(res.coverage_status, ObjectiveCoverageStatus::SourceUnavailable);
        assert!(res.diagnostics.iter().any(|d| d.contains("OCR")));
    }

    #[test]
    fn supports_transcript_backed_sources_with_timestamps() {
        let segs = vec![
            TranscriptUnitInput {
                segment_id: Some("seg-1".to_string()),
                start_ms: 60_000,
                end_ms: 95_000,
                text: "Let us examine Plato's allegory of the cave. Prisoners chained inside see only shadows on the wall, because they cannot turn toward the fire behind them. Therefore, they mistake appearances for reality until someone ascends into the sunlight.".to_string(),
                chapter: Some("Allegory of the Cave".to_string()),
            },
        ];
        let units = analyze_document_structure(StructuralSourceInput::Transcript {
            document_id: "doc-yt",
            format: "youtube",
            segments: &segs,
        });
        let src = DocumentSourceForTrail {
            document_id: "doc-yt".to_string(),
            document_title: "Plato Lecture".to_string(),
            document_revision: "rev-yt".to_string(),
            format: "youtube".to_string(),
            is_ai_excluded: false,
            readiness: SegmentReadinessStatus::Ready,
            units,
            total_length_hint: 300,
        };
        let res = retrieve_segments_for_objective(
            &[src],
            &make_query("Explain Plato's allegory of the cave", "Allegory of the Cave"),
            "2026-11-17T00:00:00Z",
        );
        assert_eq!(res.coverage_status, ObjectiveCoverageStatus::AdequatelyCovered);
        assert_eq!(res.segments[0].start_locator["kind"], "youtube");
        assert_eq!(res.segments[0].start_locator["timeSeconds"], 60.0);
    }

    #[test]
    fn planner_respects_prerequisites_and_deduplicates_shared_segments() {
        let nodes = vec![
            StudyPlanVersionNode {
                node_id: "n-dep".to_string(),
                concept_id: None,
                concept_label: "Knowledge".to_string(),
                title: "Knowledge".to_string(),
                summary: "".to_string(),
                position: 0,
                learning_objectives: vec!["Define knowledge".to_string()],
                locked: false,
                included: true,
                user_added: false,
                user_modified: false,
                material_support: MaterialSupport::Grounded,
                why_here: None,
                source_ref_ids: vec![],
            },
            StudyPlanVersionNode {
                node_id: "n-pre".to_string(),
                concept_id: None,
                concept_label: "Belief".to_string(),
                title: "Belief".to_string(),
                summary: "".to_string(),
                position: 1,
                learning_objectives: vec!["Define belief".to_string()],
                locked: false,
                included: true,
                user_added: false,
                user_modified: false,
                material_support: MaterialSupport::Grounded,
                why_here: None,
                source_ref_ids: vec![],
            },
        ];
        let prereqs = vec![PlanPrerequisite {
            dependent_node_id: "n-dep".to_string(),
            prerequisite_node_id: "n-pre".to_string(),
            support: "user".to_string(),
            rationale: None,
            source_ref_ids: vec![],
        }];
        let order = topological_concept_order(&nodes, &prereqs);
        assert_eq!(order, vec!["n-pre".to_string(), "n-dep".to_string()]);

        let trail = plan_study_trail("p1", "v1", &nodes, &prereqs, &[], &[], &[], "2026-11-17T00:00:00Z");
        assert_eq!(trail.len(), 2);
        assert_eq!(trail[0].node_id, "n-pre");
        assert_eq!(trail[1].node_id, "n-dep");

        let elig_guided = evaluate_assessment_eligibility(AssessmentEligibilityPolicy::Guided, &trail);
        assert!(elig_guided.eligible); // no segments assigned yet -> 0/0 required
        let mut req_trail = trail;
        req_trail[0].segment_id = Some("seg-1".to_string());
        req_trail[0].status = StudyTrailItemStatus::Pending;
        let elig_blocked = evaluate_assessment_eligibility(AssessmentEligibilityPolicy::Guided, &req_trail);
        assert!(!elig_blocked.eligible);
        let elig_first = evaluate_assessment_eligibility(AssessmentEligibilityPolicy::AssessmentFirst, &req_trail);
        assert!(elig_first.eligible);
        assert!(elig_first.test_out_available);
    }

    #[test]
    fn excludes_head_title_and_keeps_dropcaps_without_spaces_in_epub_html() {
        let html = r#"<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Why Buddhism is True</title></head><body><h2 class="h2n">1</h2><h2 class="h2">Taking the Red Pill</h2><p><span class="stickup">A</span>t the risk of overdramatizing the human condition: Simon &amp; Schuster explores illusion and perception. Therefore, seeing clearly requires inspecting our evolved biases because feelings can mislead us.</p></body></html>"#;
        let units = analyze_document_structure(StructuralSourceInput::EpubTitledSpines {
            document_id: "doc-dropcap",
            spines: &[(7, Some("1. Taking the Red Pill".to_string()), html.to_string())],
        });
        assert_eq!(units.len(), 1);
        assert_eq!(units[0].spine_index, Some(7));
        assert!(!units[0].text.contains("Why Buddhism is True"));
        assert!(units[0].text.starts_with("At the risk of overdramatizing"));
        assert!(units[0].text.contains("Simon & Schuster"));
        assert_eq!(units[0].title, "1: Taking the Red Pill");
    }

    #[test]
    fn excludes_flattened_single_line_index_and_endnotes() {
        let index_unit = crate::study_trail::structural_analyzer::StructuralUnit {
            unit_id: "u-idx".to_string(),
            document_id: "d1".to_string(),
            format: "epub".to_string(),
            heading_path: vec![],
            title: "Section 1".to_string(),
            text: "See also not-self anger, 17, 19, 31–32, 46, 55, 210, attention, 86, 131–41, Abrahamic mystics, 206, Buddhism, 12, 14–18, 22, meditation, 45–60.".to_string(),
            start_offset: 0,
            end_offset: 120,
            page_number: None,
            end_page_number: None,
            spine_index: Some(31),
            timestamp_ms: None,
            end_timestamp_ms: None,
            segment_id: None,
            word_count: 24,
            is_heading_only: false,
            is_repeated_running_line: false,
        };
        assert_eq!(classify_structural_unit(&index_unit), StructuralClass::Index);

        let endnotes_unit = crate::study_trail::structural_analyzer::StructuralUnit {
            unit_id: "u-notes".to_string(),
            document_id: "d1".to_string(),
            format: "epub".to_string(),
            heading_path: vec![],
            title: "Section 2".to_string(),
            text: "David Vance, “Climate Crisis,” March 9, 2022, Fox News, www.foxnews.com/politics/climate-refugees. See also January 22, 2019, Business Insider, www.businessinsider.com/china-app-2019-1.".to_string(),
            start_offset: 0,
            end_offset: 180,
            page_number: None,
            end_page_number: None,
            spine_index: Some(18),
            timestamp_ms: None,
            end_timestamp_ms: None,
            segment_id: None,
            word_count: 24,
            is_heading_only: false,
            is_repeated_running_line: false,
        };
        assert_eq!(classify_structural_unit(&endnotes_unit), StructuralClass::Bibliography);
    }

    #[test]
    fn idf_scoring_prefers_specific_conceptual_unit_with_bounded_word_aligned_locators() {
        let mut html = String::from("<h1>Chapter 1: General Background</h1>");
        for i in 0..8 {
            html.push_str(&format!(
                "<p>In meditation practice ({}) people observe their mind and world in ordinary life. Many people explore meditation and feelings across traditions as part of human experience and reflection on suffering.</p>",
                i
            ));
        }
        html.push_str("<h1>Chapter 2: Theravada and Mahayana</h1>");
        html.push_str("<p>Theravada and Mahayana represent the two major branches of Buddhism. Whereas Theravada relies on the Pali canon and emphasizes anatta (not-self) and the arahant ideal, Mahayana develops Sanskrit texts around anatman and the bodhisattva path. Therefore, one single doctrine cannot represent every Buddhist tradition.</p>");

        let units = analyze_document_structure(StructuralSourceInput::EpubSpines {
            document_id: "doc-idf",
            spines: &[(1, html)],
        });
        let src = DocumentSourceForTrail {
            document_id: "doc-idf".to_string(),
            document_title: "Buddhism Guide".to_string(),
            document_revision: "rev-1".to_string(),
            format: "epub".to_string(),
            is_ai_excluded: false,
            readiness: SegmentReadinessStatus::Ready,
            units,
            total_length_hint: 3000,
        };
        let res = retrieve_segments_for_objective(
            &[src],
            &make_query(
                "Identify Theravada and Mahayana as major Buddhist branches and explain why one doctrine cannot represent every Buddhist tradition",
                "Buddhism as a Family of Traditions",
            ),
            "2026-11-18T00:00:00Z",
        );
        assert_eq!(res.coverage_status, ObjectiveCoverageStatus::AdequatelyCovered);
        let seg = &res.segments[0];
        assert_eq!(seg.title, "Chapter 2: Theravada and Mahayana");
        assert!(seg.word_count <= 200);
        let start_q = seg.start_locator["textQuote"].as_str().unwrap();
        let end_q = seg.end_locator["textQuote"].as_str().unwrap();
        assert!(start_q.starts_with("Theravada and Mahayana"), "got: {start_q}");
        assert!(end_q.ends_with("every Buddhist tradition."), "got: {end_q}");
    }

    #[tokio::test]
    async fn real_epubs_produce_accurate_spines_and_high_signal_excerpts() {
        let buddhism_path = "/mnt/Elements/Downloads/books/epub/Robert Wright - Why Buddhism is True - The Science and Philosophy of Meditation and Enlightenment-Simon and Schuster (2016).epub";
        if std::path::Path::new(buddhism_path).exists() {
            let spines = crate::processor::epub::extract_epub_spines(buddhism_path)
                .await
                .expect("extract Buddhism EPUB spines");
            let titled: Vec<(u32, Option<String>, String)> = spines
                .into_iter()
                .map(|s| (s.spine_index, s.toc_title, s.content))
                .collect();
            let units = analyze_document_structure(StructuralSourceInput::EpubTitledSpines {
                document_id: "buddhism",
                spines: &titled,
            });
            let src = DocumentSourceForTrail {
                document_id: "buddhism".to_string(),
                document_title: "Why Buddhism is True".to_string(),
                document_revision: "rev-b".to_string(),
                format: "epub".to_string(),
                is_ai_excluded: false,
                readiness: SegmentReadinessStatus::Ready,
                units,
                total_length_hint: 600_000,
            };
            let res = retrieve_segments_for_objective(
                &[src],
                &make_query(
                    "Match anatta in Pali and anatman in Sanskrit to the concept of not-self",
                    "Canonical Languages and Translation Choices",
                ),
                "2026-11-18T00:00:00Z",
            );
            assert!(!res.segments.is_empty());
            let seg = &res.segments[0];
            let spine_idx = seg.start_locator["spineIndex"].as_u64().unwrap_or(0);
            assert!(spine_idx > 0, "expected real chapter/terminology spine, got 0");
            assert!(seg.word_count <= 950, "expected focused excerpt, got {} words", seg.word_count);
            assert!(
                !seg.parent_section_label.as_deref().unwrap_or("").eq_ignore_ascii_case("Index"),
                "must not select Index"
            );
            let start_q = seg.start_locator["textQuote"].as_str().unwrap();
            assert!(!start_q.starts_with("Why Buddhism is True "), "title leaked into quote: {start_q}");
        }

        let reset_path = "/mnt/Elements/Downloads/books/epub/Alex Jones - The Great Reset_ And the War for the World-Skyhorse (2022).epub";
        if std::path::Path::new(reset_path).exists() {
            let spines = crate::processor::epub::extract_epub_spines(reset_path)
                .await
                .expect("extract Great Reset EPUB spines");
            let titled: Vec<(u32, Option<String>, String)> = spines
                .into_iter()
                .map(|s| (s.spine_index, s.toc_title, s.content))
                .collect();
            let units = analyze_document_structure(StructuralSourceInput::EpubTitledSpines {
                document_id: "reset",
                spines: &titled,
            });
            let src = DocumentSourceForTrail {
                document_id: "reset".to_string(),
                document_title: "The Great Reset".to_string(),
                document_revision: "rev-r".to_string(),
                format: "epub".to_string(),
                is_ai_excluded: false,
                readiness: SegmentReadinessStatus::Ready,
                units,
                total_length_hint: 420_000,
            };
            let res = retrieve_segments_for_objective(
                &[src],
                &make_query(
                    "Describe how China's social credit system ranks citizens and applies punishments",
                    "Digital Identity, CBDCs, and Social Credit Systems",
                ),
                "2026-11-18T00:00:00Z",
            );
            assert!(!res.segments.is_empty());
            let seg = &res.segments[0];
            assert!(seg.start_locator["spineIndex"].as_u64().unwrap_or(0) >= 7);
            assert!(seg.word_count <= 950);
            assert!(!seg.parent_section_label.as_deref().unwrap_or("").contains("Notes"));
        }
    }

    #[tokio::test]
    async fn real_pdf_produces_verified_page_segments() {
        let pdf_path = "/home/ubuntu/books/pdf/20 rules of formulating knowledge in learning.pdf";
        if !std::path::Path::new(pdf_path).exists() {
            return;
        }
        let pages = crate::processor::pdf::extract_pdf_pages_text(pdf_path)
            .await
            .expect("extract real PDF pages");
        assert!(!pages.is_empty(), "expected extracted PDF pages");
        let total_len: usize = pages.iter().map(|p| p.len()).sum();
        let units = analyze_document_structure(StructuralSourceInput::PdfPages {
            document_id: "pdf-20-rules",
            pages: &pages,
        });
        assert!(!units.is_empty(), "expected structural units from PDF");
        let src = DocumentSourceForTrail {
            document_id: "pdf-20-rules".to_string(),
            document_title: "20 Rules of Formulating Knowledge".to_string(),
            document_revision: "rev-pdf".to_string(),
            format: "pdf".to_string(),
            is_ai_excluded: false,
            readiness: SegmentReadinessStatus::Ready,
            units,
            total_length_hint: total_len,
        };
        let res = retrieve_segments_for_objective(
            &[src],
            &make_query(
                "Explain the minimum information principle and why simple cloze deletions beat complex items",
                "Minimum Information Principle",
            ),
            "2026-11-18T00:00:00Z",
        );
        assert!(
            matches!(
                res.coverage_status,
                ObjectiveCoverageStatus::AdequatelyCovered | ObjectiveCoverageStatus::MultiSegment
            ),
            "unexpected coverage status: {:?}",
            res.coverage_status
        );
        assert!(!res.segments.is_empty());
        let seg = &res.segments[0];
        assert_eq!(seg.start_locator["kind"], "pdf");
        assert_eq!(seg.end_locator["kind"], "pdf");
        let start_page = seg.start_locator["pageNumber"].as_u64().unwrap_or(0) as usize;
        let end_page = seg.end_locator["pageNumber"].as_u64().unwrap_or(0) as usize;
        assert!(start_page >= 1 && start_page <= pages.len());
        assert!(end_page >= start_page && end_page <= pages.len());
        assert!(seg.word_count <= 950, "expected focused PDF excerpt, got {}", seg.word_count);

        let matched_text_lower = format!(
            "{} {} {} {}",
            seg.title,
            seg.parent_section_label.as_deref().unwrap_or(""),
            seg.excerpt_preview,
            pages[start_page - 1..end_page].join(" ")
        )
        .to_ascii_lowercase();
        assert!(
            matched_text_lower.contains("minimum information")
                || matched_text_lower.contains("cloze")
                || matched_text_lower.contains("simple"),
            "expected relevant passage for minimum information/cloze, got: {} — {}",
            seg.title,
            seg.excerpt_preview
        );

        let start_q = seg.start_locator["textQuote"].as_str().unwrap_or("").trim();
        let end_q = seg.end_locator["textQuote"].as_str().unwrap_or("").trim();
        assert!(!start_q.is_empty(), "expected non-empty PDF start textQuote");
        assert!(!end_q.is_empty(), "expected non-empty PDF end textQuote");

        // Verify quotes occur in their respective page texts at word boundaries
        let normalize = |s: &str| s.split_whitespace().collect::<Vec<_>>().join(" ");
        let start_page_norm = normalize(&pages[start_page - 1]);
        let end_page_norm = normalize(&pages[end_page - 1]);
        let start_q_norm = normalize(start_q);
        let end_q_norm = normalize(end_q);
        if let Some(pos) = start_page_norm.find(&start_q_norm) {
            if pos > 0 {
                let prev = start_page_norm[..pos].chars().last().unwrap();
                assert!(prev.is_whitespace(), "start textQuote clipped mid-word: {start_q_norm}");
            }
        } else {
            panic!("start textQuote not found on page {start_page}: {start_q_norm}");
        }
        if let Some(pos) = end_page_norm.rfind(&end_q_norm) {
            let after_idx = pos + end_q_norm.len();
            if after_idx < end_page_norm.len() {
                let next = end_page_norm[after_idx..].chars().next().unwrap();
                assert!(next.is_whitespace(), "end textQuote clipped mid-word: {end_q_norm}");
            }
        } else {
            panic!("end textQuote not found on page {end_page}: {end_q_norm}");
        }
    }
}
