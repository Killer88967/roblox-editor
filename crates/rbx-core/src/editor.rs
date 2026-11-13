use rbx_dom_weak::types::{Ref, Variant};
use rbx_dom_weak::{InstanceBuilder, WeakDom, ustr};

use crate::document::Document;
use crate::error::Result;
use crate::ops::{self, Op};

pub struct Editor {
    doc: Document,
    graveyard: WeakDom,
    undo_stack: Vec<Vec<Op>>,
    redo_stack: Vec<Vec<Op>>,
}

impl Editor {
    pub fn new(doc: Document) -> Self {
        Self {
            doc,
            graveyard: WeakDom::new(InstanceBuilder::new("Folder")),
            undo_stack: Vec::new(),
            redo_stack: Vec::new(),
        }
    }

    pub fn document(&self) -> &Document {
        &self.doc
    }

    pub fn dom(&self) -> &WeakDom {
        self.doc.dom()
    }

    pub fn property(&self, target: Ref, key: &str) -> Option<&Variant> {
        self.dom().get_by_ref(target)?.properties.get(&ustr(key))
    }

    /// Applies ops as one undoable step. Returns refs of created instances.
    pub fn apply(&mut self, ops: Vec<Op>) -> Result<Vec<Ref>> {
        let (inverses, created) = self.run(ops)?;
        if !inverses.is_empty() {
            self.undo_stack.push(inverses);
            self.redo_stack.clear();
        }
        Ok(created)
    }

    pub fn undo(&mut self) -> Result<bool> {
        let Some(batch) = self.undo_stack.pop() else {
            return Ok(false);
        };
        let (inverses, _) = self.run(batch)?;
        self.redo_stack.push(inverses);
        Ok(true)
    }

    pub fn redo(&mut self) -> Result<bool> {
        let Some(batch) = self.redo_stack.pop() else {
            return Ok(false);
        };
        let (inverses, _) = self.run(batch)?;
        self.undo_stack.push(inverses);
        Ok(true)
    }

    pub fn can_undo(&self) -> bool {
        !self.undo_stack.is_empty()
    }

    pub fn can_redo(&self) -> bool {
        !self.redo_stack.is_empty()
    }

    /// Runs a batch atomically: on error, everything already applied is rolled back.
    fn run(&mut self, ops: Vec<Op>) -> Result<(Vec<Op>, Vec<Ref>)> {
        let mut inverses = Vec::with_capacity(ops.len());
        let mut created = Vec::new();

        for op in ops {
            match ops::apply(self.doc.dom_mut(), &mut self.graveyard, op) {
                Ok((inverse, new_ref)) => {
                    inverses.push(inverse);
                    created.extend(new_ref);
                }
                Err(err) => {
                    for inverse in inverses.into_iter().rev() {
                        let _ = ops::apply(self.doc.dom_mut(), &mut self.graveyard, inverse);
                    }
                    return Err(err);
                }
            }
        }

        inverses.reverse();
        Ok((inverses, created))
    }
}
