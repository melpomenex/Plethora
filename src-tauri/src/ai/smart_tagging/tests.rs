//! Unit tests and false-positive regression suite for Smart Tagging backend

use super::*;
use super::domain_signatures::*;
use super::policy::PolicyConfig;
use super::salience::*;
use super::tokenizer::*;

#[test]
fn test_negative_fixture_software_not_history() {
    let title = "Modern Software Architecture and Hardware Optimization";
    let body = "This guide discusses software development pipelines, hardware drivers, forward error correction, award winning architectures, and warning diagnostics.";
    let existing = vec![("History".to_string(), 10), ("Computer Science".to_string(), 20)];
    let result = classify_document_baseline(title, &[], body, &existing, &[], &[], None);

    assert!(!result.iter().any(|t| t.tag == "History"), "Software must NOT trigger History tag");
    assert!(result.iter().any(|t| t.tag == "Computer Science" || t.tag.contains("Software")), "Should identify Computer Science / Software");
}

#[test]
fn test_negative_fixture_cellphone_not_biology() {
    let title = "Handling Flight Cancellations and Cellphone Roaming";
    let body = "Users experienced unexpected cancellations when their cellphone was roaming in Europe.";
    let existing = vec![("Biology".to_string(), 15)];
    let result = classify_document_baseline(title, &[], body, &existing, &[], &[], None);

    assert!(!result.iter().any(|t| t.tag == "Biology"), "Cancellations / cellphone must NOT trigger Biology tag");
}

#[test]
fn test_negative_fixture_programming_average_table_not_math() {
    let title = "Database Query Optimization and Index Performance";
    let body = "The table stores user data. We calculate average query latency and mean response times using mathematical functions.";
    let existing = vec![("Mathematics".to_string(), 15), ("Databases".to_string(), 10)];
    let result = classify_document_baseline(title, &[], body, &existing, &[], &[], None);

    assert!(!result.iter().any(|t| t.tag == "Mathematics"), "Average / table in programming text must NOT trigger Mathematics tag");
}

#[test]
fn test_negative_fixture_history_average_citizen_not_math() {
    let title = "Life of the Average Citizen in the Roman Empire";
    let body = "During the reign of the Roman emperors, an average citizen worked in agriculture or trades. The historical record shows centuries of stability.";
    let existing = vec![("Mathematics".to_string(), 10), ("History".to_string(), 20)];
    let result = classify_document_baseline(title, &[], body, &existing, &[], &[], None);

    assert!(!result.iter().any(|t| t.tag == "Mathematics"), "Average citizen in history text must NOT trigger Mathematics");
    assert!(result.iter().any(|t| t.tag == "History"), "Roman empire text must trigger History");
}

#[test]
fn test_positive_fixture_differential_equations_math() {
    let title = "Nonlinear Differential Equations and Vector Calculus";
    let body = "In this chapter, we solve boundary value problems using eigenvalues, matrix multiplication, and Fourier transform theorem proofs.";
    let existing = vec![("Mathematics".to_string(), 5)];
    let result = classify_document_baseline(title, &["Eigenvalue Analysis"], body, &existing, &[], &[], None);

    assert!(result.iter().any(|t| t.tag == "Mathematics"), "Differential equations text MUST trigger Mathematics");
    assert!(result.iter().any(|t| t.confidence >= 0.70));
}

#[test]
fn test_positive_fixture_linux_kernel_scheduling() {
    let title = "Linux Kernel Process Management and CPU Scheduling";
    let body = "The Completely Fair Scheduler (CFS) allocates virtual runtime to threads in operating systems. Memory management involves virtual memory and page tables.";
    let existing = vec![("Operating Systems".to_string(), 10), ("Linux".to_string(), 8)];
    let result = classify_document_baseline(title, &[], body, &existing, &[], &[], None);

    assert!(result.iter().any(|t| t.tag == "Operating Systems"), "Linux scheduling text MUST trigger Operating Systems");
}

#[test]
fn test_positive_fixture_roman_republic_history() {
    let title = "Fall of the Roman Republic";
    let body = "In the first century BC, political strife destabilized the Roman Republic and ancient civilization, leading to civil war and the rise of the Roman Empire.";
    let existing = vec![("History".to_string(), 10)];
    let result = classify_document_baseline(title, &[], body, &existing, &[], &[], None);

    assert!(result.iter().any(|t| t.tag == "History"), "Roman Republic text MUST trigger History");
}

#[test]
fn test_taxonomy_preference_reuses_existing_tag() {
    let title = "Deep Residual Learning and Convolutional Neural Networks";
    let body = "Supervised machine learning models trained on large image datasets.";
    // Library already contains "Machine Learning"
    let existing = vec![("Machine Learning".to_string(), 50)];
    let result = classify_document_baseline(title, &[], body, &existing, &[], &[], None);

    assert!(result.iter().any(|t| t.tag == "Machine Learning"), "Must reuse existing 'Machine Learning' tag");
    assert!(!result.iter().any(|t| t.tag == "AI / ML" || t.tag == "ML"), "Must not invent synonym tags");
}

#[test]
fn test_manual_tag_protection_and_dismissal() {
    let title = "Quantum Mechanics and Wavefunction Collapse";
    let body = "Schrodinger equation describes quantum state evolution in particle physics.";
    let existing = vec![("Physics".to_string(), 10)];

    // Case 1: Physics already in manual_tags -> not duplicated in smart suggestions
    let result1 = classify_document_baseline(title, &[], body, &existing, &["Physics".to_string()], &[], None);
    assert!(!result1.iter().any(|t| t.tag == "Physics"), "Already manual tag should not be re-suggested");

    // Case 2: Physics was dismissed by user -> suppressed
    let result2 = classify_document_baseline(title, &[], body, &existing, &[], &["Physics".to_string()], None);
    assert!(!result2.iter().any(|t| t.tag == "Physics"), "Dismissed tag must never be re-suggested");
}

#[test]
fn test_zero_tags_on_insufficient_evidence() {
    let title = "Quick notes";
    let body = "Met with John today. Remember to pick up groceries.";
    let existing = vec![("Mathematics".to_string(), 10), ("History".to_string(), 10)];
    let result = classify_document_baseline(title, &[], body, &existing, &[], &[], None);

    assert_eq!(result.len(), 0, "Unrelated short prose must produce 0 tags");
}
