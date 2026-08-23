package com.plethora.androidsearch

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class AppSearchPolicyTest {
    @Test
    fun defaultOffAndNeverDisplayedBySystem() {
        assertFalse(AppSearchPolicy.DISPLAYED_BY_SYSTEM)
        assertFalse(AppSearchPolicy.enabled(null))
        assertFalse(AppSearchPolicy.enabled(false))
        assertTrue(AppSearchPolicy.enabled(true))
    }

    @Test
    fun upsertDeleteAndRebuildCascade() {
        DerivedIndex.rebuild()
        DerivedIndex.upsert("doc-1", "library", "photosynthesis", "v1")
        DerivedIndex.upsert("doc-2", "help", "import a pdf", "v1")
        assertEquals(1, DerivedIndex.retrieve("photo", 8, "library").size)
        DerivedIndex.delete("doc-1")
        assertEquals(0, DerivedIndex.retrieve("photo", 8, "library").size)
        DerivedIndex.upsert("doc-3", "library", "keep", null)
        DerivedIndex.rebuild()
        assertEquals(0, DerivedIndex.retrieve("keep", 8, "library").size)
    }
}
