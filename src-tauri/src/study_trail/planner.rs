use crate::models::study_plan::{PlanPrerequisite, StudyPlanVersionNode};
use crate::models::study_trail::{
    LearningSegment, LearningSegmentObjectiveLink, StudyTrailItem, StudyTrailItemStatus,
};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};

fn stable_trail_item_id(version_id: &str, node_id: &str, objective_index: i64, segment_id: Option<&str>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(version_id.as_bytes());
    hasher.update(b"|");
    hasher.update(node_id.as_bytes());
    hasher.update(b"|");
    hasher.update(objective_index.to_string().as_bytes());
    hasher.update(b"|");
    hasher.update(segment_id.unwrap_or("none").as_bytes());
    format!("sti_{}", &format!("{:x}", hasher.finalize())[..20])
}

/// Computes prerequisite-aware topological Concept Order.
/// Returns node_ids in valid dependency order, breaking ties by `position` and `node_id`.
pub fn topological_concept_order(
    nodes: &[StudyPlanVersionNode],
    prerequisites: &[PlanPrerequisite],
) -> Vec<String> {
    let included: HashMap<&str, &StudyPlanVersionNode> = nodes
        .iter()
        .filter(|n| n.included)
        .map(|n| (n.node_id.as_str(), n))
        .collect();

    let mut in_degree: HashMap<&str, usize> = included.keys().map(|&id| (id, 0)).collect();
    let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();

    for edge in prerequisites {
        let from = edge.prerequisite_node_id.as_str();
        let to = edge.dependent_node_id.as_str();
        if included.contains_key(from) && included.contains_key(to) && from != to {
            *in_degree.entry(to).or_insert(0) += 1;
            dependents.entry(from).or_default().push(to);
        }
    }

    let mut ready: Vec<&str> = in_degree
        .iter()
        .filter(|(_, &deg)| deg == 0)
        .map(|(&id, _)| id)
        .collect();

    let sort_ready = |list: &mut Vec<&str>| {
        list.sort_by(|a, b| {
            let pa = included.get(a).map(|n| n.position).unwrap_or(i32::MAX);
            let pb = included.get(b).map(|n| n.position).unwrap_or(i32::MAX);
            pa.cmp(&pb).then_with(|| a.cmp(b))
        });
    };

    let mut ordered = Vec::with_capacity(included.len());
    while !ready.is_empty() {
        sort_ready(&mut ready);
        let next = ready.remove(0);
        ordered.push(next.to_string());
        if let Some(children) = dependents.get(next) {
            for &child in children {
                if let Some(deg) = in_degree.get_mut(child) {
                    *deg = deg.saturating_sub(1);
                    if *deg == 0 {
                        ready.push(child);
                    }
                }
            }
        }
    }

    // Fallback for any cycle: append remaining nodes deterministically
    if ordered.len() < included.len() {
        let seen: HashSet<&str> = ordered.iter().map(String::as_str).collect();
        let mut rest: Vec<&str> = included.keys().copied().filter(|id| !seen.contains(id)).collect();
        sort_ready(&mut rest);
        ordered.extend(rest.into_iter().map(str::to_string));
    }

    ordered
}

/// Plans an ordered Study Trail from Concept Order + Source Order + existing learner/author state.
///
/// Distinguishes:
/// - **Concept Order**: Topological dependency order from `study_plan_prerequisites`.
/// - **Source Order**: `(document_id, start_offset)` within the same source.
/// - **Study Order**: Follows Concept Order while preferring Source Order continuity among
///   prerequisite-ready objectives, grouping adjacent sections into coherent sessions, and
///   deduplicating shared `LearningSegment`s.
pub fn plan_study_trail(
    plan_id: &str,
    version_id: &str,
    nodes: &[StudyPlanVersionNode],
    prerequisites: &[PlanPrerequisite],
    links: &[LearningSegmentObjectiveLink],
    segments: &[LearningSegment],
    existing_items: &[StudyTrailItem],
    now_iso: &str,
) -> Vec<StudyTrailItem> {
    let segment_map: HashMap<&str, &LearningSegment> =
        segments.iter().map(|s| (s.id.as_str(), s)).collect();
    let existing_by_key: HashMap<(&str, i64), &StudyTrailItem> = existing_items
        .iter()
        .filter(|item| !item.is_remediation)
        .map(|item| ((item.node_id.as_str(), item.objective_index), item))
        .collect();

    let concept_order = topological_concept_order(nodes, prerequisites);
    let node_map: HashMap<&str, &StudyPlanVersionNode> =
        nodes.iter().map(|n| (n.node_id.as_str(), n)).collect();

    // Build prerequisite map for source-continuity tie-breaking among ready nodes
    let mut prereq_map: HashMap<&str, Vec<&str>> = HashMap::new();
    for edge in prerequisites {
        prereq_map
            .entry(edge.dependent_node_id.as_str())
            .or_default()
            .push(edge.prerequisite_node_id.as_str());
    }

    // Determine primary/required link for each (node_id, objective_index)
    let mut primary_links: HashMap<(&str, i64), &LearningSegmentObjectiveLink> = HashMap::new();
    for link in links {
        let key = (link.node_id.as_str(), link.objective_index);
        let replace = match primary_links.get(&key) {
            None => true,
            Some(curr) => {
                (link.authored_override && !curr.authored_override)
                    || (link.is_primary && !curr.is_primary)
            }
        };
        if replace {
            primary_links.insert(key, link);
        }
    }

    let mut planned = Vec::new();
    let mut seen_segments: HashSet<String> = HashSet::new();
    let mut last_doc_id: Option<String> = None;
    let mut last_end_offset: Option<i64> = None;
    let mut session_idx = 0usize;
    let mut order_counter = 0i64;

    for node_id in &concept_order {
        let Some(node) = node_map.get(node_id.as_str()) else {
            continue;
        };
        let obj_count = node.learning_objectives.len().max(1);

        // Sort objectives within the node by source order if available
        let mut obj_indices: Vec<usize> = (0..obj_count).collect();
        obj_indices.sort_by(|&a, &b| {
            let sa = primary_links
                .get(&(node_id.as_str(), a as i64))
                .and_then(|l| segment_map.get(l.segment_id.as_str()));
            let sb = primary_links
                .get(&(node_id.as_str(), b as i64))
                .and_then(|l| segment_map.get(l.segment_id.as_str()));
            match (sa, sb) {
                (Some(la), Some(lb)) => la
                    .document_id
                    .cmp(&lb.document_id)
                    .then_with(|| la.start_offset.unwrap_or(0).cmp(&lb.start_offset.unwrap_or(0))),
                (Some(_), None) => std::cmp::Ordering::Less,
                (None, Some(_)) => std::cmp::Ordering::Greater,
                (None, None) => a.cmp(&b),
            }
        });

        for obj_idx in obj_indices {
            let obj_i64 = obj_idx as i64;
            let prev_item = existing_by_key.get(&(node_id.as_str(), obj_i64));
            let link = primary_links.get(&(node_id.as_str(), obj_i64)).copied();
            let seg = link.and_then(|l| segment_map.get(l.segment_id.as_str())).copied();

            // Deduplicate shared segments: if already scheduled, skip duplicate reading
            // unless user manually overrode it.
            let seg_id_opt = seg.map(|s| s.id.clone());
            let is_duplicate_segment = seg_id_opt
                .as_ref()
                .is_some_and(|sid| !seen_segments.insert(sid.clone()));

            if is_duplicate_segment && prev_item.and_then(|p| p.manual_order_override).is_none() {
                continue;
            }

            // Session grouping for adjacent sections of the same document
            let session_group_id = if let Some(s) = seg {
                let same_doc = last_doc_id.as_deref() == Some(s.document_id.as_str());
                let adjacent = match (last_end_offset, s.start_offset) {
                    (Some(prev_end), Some(curr_start)) => curr_start >= prev_end && (curr_start - prev_end) < 2500,
                    _ => false,
                };
                if !same_doc || !adjacent {
                    session_idx += 1;
                }
                last_doc_id = Some(s.document_id.clone());
                last_end_offset = s.end_offset;
                Some(format!("session_{}", session_idx))
            } else {
                None
            };

            let rationale = if let (Some(l), Some(s)) = (link, seg) {
                format!(
                    "Scheduled after prerequisites in {} ({}) — {}",
                    s.title,
                    s.parent_section_label.as_deref().unwrap_or(&s.format),
                    l.selection_rationale
                )
            } else {
                "No verified instructional segment available for this objective yet.".to_string()
            };

            order_counter += 1;
            let trail_order = prev_item
                .and_then(|p| p.manual_order_override)
                .unwrap_or(order_counter);

            planned.push(StudyTrailItem {
                id: prev_item
                    .map(|p| p.id.clone())
                    .unwrap_or_else(|| stable_trail_item_id(version_id, node_id, obj_i64, seg_id_opt.as_deref())),
                plan_id: plan_id.to_string(),
                version_id: version_id.to_string(),
                node_id: node_id.clone(),
                objective_index: obj_i64,
                segment_id: seg_id_opt,
                trail_order,
                session_group_id,
                status: prev_item.map(|p| p.status).unwrap_or(StudyTrailItemStatus::Pending),
                reading_progress: prev_item.map(|p| p.reading_progress).unwrap_or(0.0),
                last_locator: prev_item.and_then(|p| p.last_locator.clone()),
                is_required: link.map(|l| l.is_required).unwrap_or(true),
                is_remediation: false,
                remediation_gap_id: None,
                manual_order_override: prev_item.and_then(|p| p.manual_order_override),
                rejected_reason: prev_item.and_then(|p| p.rejected_reason.clone()),
                planner_rationale: rationale,
                updated_at: now_iso.to_string(),
            });
        }
    }

    // Preserve any active remediation items
    for item in existing_items.iter().filter(|i| i.is_remediation) {
        planned.push(item.clone());
    }

    planned.sort_by_key(|item| item.trail_order);
    planned
}
