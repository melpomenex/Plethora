//! Copy-only structural PDF edits.

use lopdf::{Dictionary, Document, Object, ObjectId};
use serde::Deserialize;
use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Write};
use std::path::Path;

// Both the parser and the output verification need a complete PDF object graph.
const MAX_EDIT_BYTES: u64 = 128 * 1024 * 1024;

pub fn rotate_page_copy(source: &Path, destination: &Path, page_number: u32) -> Result<(), String> {
    export_pdf_copy(source, destination, PdfCopyPlan::Rotate { page_number })
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum PdfCopyPlan {
    Rotate { page_number: u32 },
    Pages { pages: Vec<u32>, crop_points: Option<f64> },
}

pub fn export_pdf_copy(source: &Path, destination: &Path, plan: PdfCopyPlan) -> Result<(), String> {
    let mut document = read_editable_pdf(source)?;
    let pages = document.get_pages();
    let (expected_order, rotation) = match plan {
        PdfCopyPlan::Rotate { page_number } => {
            let page_id = *pages.get(&page_number).ok_or("The selected PDF page does not exist.")?;
            let rotation = (inherited_rotation(&document, page_id)?.rem_euclid(360) + 90) % 360;
            document.get_dictionary_mut(page_id)
                .map_err(|_| "Could not update the selected PDF page.")?.set("Rotate", rotation);
            (pages.into_values().collect::<Vec<_>>(), Some((page_id, rotation)))
        }
        PdfCopyPlan::Pages { pages: order, crop_points } => {
            let ids = order.iter().map(|page| pages.get(page).copied().ok_or("The page list contains a page outside this PDF."))
                .collect::<Result<Vec<_>, _>>()?;
            rewrite_pages(&mut document, &ids, crop_points)?;
            (ids, None)
        }
    };
    write_verified_copy(document, destination, |verified| {
        if verified.get_pages().into_values().ne(expected_order) {
            return Err("The PDF copy could not be verified.".into());
        }
        if let Some((page, expected)) = rotation {
            if inherited_rotation(verified, page)? != expected {
                return Err("The PDF rotation could not be verified.".into());
            }
        }
        Ok(())
    })
}

fn read_editable_pdf(source: &Path) -> Result<Document, String> {
    let mut bytes = Vec::new();
    File::open(source)
        .and_then(|file| file.take(MAX_EDIT_BYTES + 1).read_to_end(&mut bytes))
        .map_err(|_| "Could not read the original PDF.")?;
    if bytes.len() as u64 > MAX_EDIT_BYTES {
        return Err("PDF copy export supports PDFs up to 128 MiB.".into());
    }
    let document =
        Document::load_mem(&bytes).map_err(|_| "Could not open the original PDF.")?;
    drop(bytes);
    if document.is_encrypted() {
        return Err("PDF copy export is unavailable for encrypted PDFs.".into());
    }
    if document
        .catalog()
        .is_ok_and(|catalog| catalog.has(b"Perms"))
        || document
            .objects
            .values()
            .filter_map(|value| value.as_dict().ok())
            .any(|dict| {
                [b"Type".as_slice(), b"FT"].iter().any(|key| {
                    dict.get_deref(key, &document)
                        .and_then(Object::as_name)
                        .is_ok_and(|name| name == b"Sig")
                })
            })
    {
        return Err("PDF copy export is unavailable for PDFs with signature fields.".into());
    }

    Ok(document)
}

fn write_verified_copy(
    mut document: Document,
    destination: &Path,
    verify: impl FnOnce(&Document) -> Result<(), String>,
) -> Result<(), String> {
    write_new_file(destination, |file| {
        document.save_to(file).map_err(|_| "Could not write the PDF copy.")?;
        drop(document);
        Ok(())
    }, |path| {
        let verified = Document::load(path).map_err(|_| "Could not reopen the PDF copy.")?;
        verify(&verified)
    })
}

fn write_new_file(
    destination: &Path,
    write: impl FnOnce(&mut File) -> Result<(), String>,
    verify: impl FnOnce(&Path) -> Result<(), String>,
) -> Result<(), String> {
    let directory = destination
        .parent()
        .ok_or("Choose a folder for the PDF copy.")?;
    let mut output = tempfile::NamedTempFile::new_in(directory)
        .map_err(|_| "Could not create a PDF copy in the selected folder.")?;
    write(output.as_file_mut())?;
    output
        .as_file()
        .sync_all()
        .map_err(|_| "Could not finish writing the PDF copy.")?;
    verify(output.path())?;
    output.persist_noclobber(destination).map_err(|error| {
        if error.error.kind() == std::io::ErrorKind::AlreadyExists {
            "A file already exists at this location. Choose a new name."
        } else {
            "Could not save the verified PDF copy."
        }
    })?;
    Ok(())
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PdfArtifactFormat {
    FilledPdf,
    Text,
    Html,
    Png,
}

impl PdfArtifactFormat {
    pub fn extension(self) -> &'static str {
        match self {
            Self::FilledPdf => "pdf",
            Self::Text => "txt",
            Self::Html => "html",
            Self::Png => "png",
        }
    }
}

pub fn save_pdf_artifact(
    source: &Path,
    destination: &Path,
    format: PdfArtifactFormat,
    bytes: &[u8],
) -> Result<(), String> {
    if bytes.is_empty() {
        return Err("The exported file is empty.".into());
    }
    let expected_pages = match format {
        PdfArtifactFormat::FilledPdf => Some(read_editable_pdf(source)?.get_pages().len()),
        PdfArtifactFormat::Png if !bytes.starts_with(b"\x89PNG\r\n\x1a\n") => {
            return Err("The exported image is not a PNG.".into());
        }
        PdfArtifactFormat::Text | PdfArtifactFormat::Html if std::str::from_utf8(bytes).is_err() => {
            return Err("The exported text is not UTF-8.".into());
        }
        _ => None,
    };
    write_new_file(destination, |file| {
        file.write_all(bytes).map_err(|_| "Could not write the exported file.".into())
    }, |path| {
        if let Some(expected_pages) = expected_pages {
            let output = Document::load(path).map_err(|_| "Could not reopen the filled PDF copy.")?;
            if output.is_encrypted() || output.get_pages().len() != expected_pages {
                return Err("The filled PDF copy could not be verified.".into());
            }
        }
        Ok(())
    })
}

fn inherited_rotation(document: &Document, node: ObjectId) -> Result<i64, &'static str> {
    match inherited(document, node, b"Rotate")? {
        None => Ok(0),
        Some(value) => resolve_value(document, &value)?.as_i64().ok().filter(|value| value % 90 == 0)
            .ok_or("Invalid PDF page rotation."),
    }
}

fn resolve_value<'a>(document: &'a Document, value: &'a Object) -> Result<&'a Object, &'static str> {
    value.as_reference().map_or(Ok(value), |id| document.get_object(id))
        .map_err(|_| "Invalid PDF object reference.")
}

fn inherited(document: &Document, mut node: ObjectId, key: &[u8]) -> Result<Option<Object>, &'static str> {
    let mut visited = HashSet::new();
    while visited.insert(node) {
        let dictionary = document.get_dictionary(node).map_err(|_| "Invalid PDF page tree.")?;
        if let Ok(value) = dictionary.get(key) {
            return Ok(Some(value.clone()));
        }
        match dictionary.get(b"Parent") {
            Ok(parent) => node = parent.as_reference().map_err(|_| "Invalid PDF page tree.")?,
            Err(_) => return Ok(None),
        }
    }
    Err("Invalid PDF page tree.")
}

fn rewrite_pages(document: &mut Document, ids: &[ObjectId], crop_points: Option<f64>) -> Result<(), String> {
    let unique = ids.iter().copied().collect::<HashSet<_>>();
    if ids.is_empty() || ids.len() != unique.len() {
        return Err("Choose one or more distinct physical pages.".into());
    }
    let original_order: Vec<_> = document.get_pages().into_values().collect();
    let same_order = ids == original_order;
    if same_order && crop_points.is_none() {
        return Ok(());
    }

    let catalog = document.catalog().map_err(|_| "Invalid PDF catalog.")?;
    let pages_root = catalog.get(b"Pages").and_then(Object::as_reference)
        .map_err(|_| "Invalid PDF page tree root.")?;
    if !same_order && [b"PageLabels".as_slice(), b"StructTreeRoot", b"Threads"].iter().any(|key| catalog.has(key)) {
        return Err("Page selection and reordering are unavailable for PDFs with page labels, tags or article threads.".into());
    }
    let rewritten = ids.iter().map(|page| {
        let mut dictionary = document.get_dictionary(*page).map_err(|_| "Invalid PDF page.")?.clone();
        if !same_order {
            dictionary.set("Parent", pages_root);
            for key in [b"MediaBox".as_slice(), b"CropBox", b"Resources", b"Rotate"] {
                if let Some(value) = inherited(document, *page, key)? {
                    dictionary.set(key.to_vec(), value);
                }
            }
        }
        if let Some(points) = crop_points {
            dictionary.set("CropBox", cropped_box(document, *page, points)?);
        }
        Ok::<Dictionary, String>(dictionary)
    }).collect::<Result<Vec<_>, _>>()?;

    for (id, page) in ids.iter().zip(rewritten) {
        document.objects.insert(*id, Object::Dictionary(page));
    }
    if !same_order {
        let parent = document.get_dictionary_mut(pages_root).map_err(|_| "Invalid PDF page tree.")?;
        parent.set("Kids", ids.iter().copied().map(Object::Reference).collect::<Vec<_>>());
        parent.set("Count", ids.len() as i64);
        let reachable = document.traverse_objects(|_| {}).into_iter().collect::<HashSet<_>>();
        if original_order.into_iter().any(|id| !unique.contains(&id) && reachable.contains(&id)) {
            return Err("This page selection leaves a link, outline or form pointing to an omitted page. Keep its destination page in the copy.".into());
        }
        document.objects.retain(|id, _| reachable.contains(id));
    }
    Ok(())
}

fn cropped_box(document: &Document, page: ObjectId, points: f64) -> Result<Vec<Object>, String> {
    if !points.is_finite() || points <= 0.0 {
        return Err("Crop margins must be positive points.".into());
    }
    let value = inherited(document, page, b"CropBox")?
        .or(inherited(document, page, b"MediaBox")?)
        .ok_or("This page has no valid page box.")?;
    let value = resolve_value(document, &value)?;
    let coordinates = value.as_array().map_err(|_| "Invalid PDF page box.")?;
    let values = coordinates.iter().map(|coordinate| coordinate.as_float().map(f64::from))
        .collect::<Result<Vec<_>, _>>().map_err(|_| "Invalid PDF page box.")?;
    let [left, bottom, right, top] = values.as_slice() else { return Err("Invalid PDF page box.".into()); };
    let cropped = [left + points, bottom + points, right - points, top - points];
    if cropped[2] <= cropped[0] || cropped[3] <= cropped[1] {
        return Err("The crop margin is too large for at least one page.".into());
    }
    Ok(cropped.into_iter().map(|value| Object::Real(value as f32)).collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rotates_one_page_in_a_new_copy_and_refuses_existing_destinations() {
        let original = include_bytes!("../../tests/fixtures/pdf-baseline/native-annotations.pdf");
        let directory = tempfile::tempdir().unwrap();
        let source = directory.path().join("source.pdf");
        let destination = directory.path().join("copy.pdf");
        std::fs::write(&source, original).unwrap();

        assert!(rotate_page_copy(&source, &source, 2).is_err());
        assert!(rotate_page_copy(&source, &destination, 4).is_err());
        assert!(!destination.exists());
        rotate_page_copy(&source, &destination, 2).unwrap();
        let copy = std::fs::read(&destination).unwrap();
        assert!(rotate_page_copy(&source, &destination, 1).is_err());
        assert_eq!(std::fs::read(&source).unwrap(), original);
        assert_eq!(std::fs::read(&destination).unwrap(), copy);

        let input = Document::load_mem(original).unwrap();
        let output = Document::load_mem(&copy).unwrap();
        let pages = output.get_pages();
        assert_eq!(pages, input.get_pages());
        assert_eq!(inherited_rotation(&output, pages[&1]).unwrap(), 0);
        assert_eq!(inherited_rotation(&output, pages[&2]).unwrap(), 90);
        assert_eq!(inherited_rotation(&output, pages[&3]).unwrap(), 0);
        assert_eq!(output.get_page_annotations(pages[&1]).unwrap().len(), 3);
    }
}
