'use client';
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion } from 'framer-motion';
import Image from 'next/image';
import { supabase } from '@/lib/supabaseClient';
import { Search, ChevronsUp, RotateCw, ChevronRight, ChevronLeft } from 'lucide-react';

// Hook for Debouncing - delay an action until the user has stopped typing for a specific amount of time
const useDebounce = (value, delay) => {
    const [debouncedValue, setDebouncedValue] = useState(value);

    useEffect(() => {
        // Set up a timer to update the debounced value after the specified delay
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        // Clean up the previous timer if the value changes before the delay has passed
        return () => {
            clearTimeout(handler);
        };
    }, [value, delay]);

    return debouncedValue;
};

// Hooks for columns and mobile detection
const useColumns = () => {
    const getColumns = () => {
        if (typeof window === 'undefined') return 1;
        if (window.innerWidth >= 1280) return 7;
        if (window.innerWidth >= 1024) return 5;
        if (window.innerWidth >= 768) return 4;
        return 2;
    };
    const [numColumns, setNumColumns] = useState(1);
    useEffect(() => {
        setNumColumns(getColumns());
        const handleResize = () => setNumColumns(getColumns());
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);
    return numColumns;
};
const useIsMobile = (breakpoint = 768) => {
    // 768px covers iPhone + Android + small iPad portrait
    const [isMobile, setIsMobile] = useState(false);
    useEffect(() => {
        const checkDeviceSize = () => {
            setIsMobile(window.innerWidth < breakpoint);
        };
        checkDeviceSize();
        window.addEventListener('resize', checkDeviceSize);
        return () => window.removeEventListener('resize', checkDeviceSize);
    }, [breakpoint]);
    return isMobile;
};

const Gallery = () => {
    const [images, setImages] = useState([]); // An array to store all the image objects fetched from Supabase
    const [page, setPage] = useState(1); // A number to keep track of which page of results to fetch for infinite scrolling
    const [loading, setLoading] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [hasMore, setHasMore] = useState(true); // A boolean to know if there are more images to load from the database
    const [selectedImage, setSelectedImage] = useState(null); // Stores the image object that the user clicks on to open in the full-screen modal
    const [rotation, setRotation] = useState(0);
    const [showScrollTopButton, setShowScrollTopButton] = useState(false);
    const numColumns = useColumns();
    const isMobile = useIsMobile();
    const touchStartX = useRef(0);
    const touchEndX = useRef(0);

    // Apply the debounce hook here
    const debouncedSearchTerm = useDebounce(searchTerm, 500); // Wait 500ms after user stops typing

    const PAGE_LIMIT = 14; // A constant defining how many images to fetch per request

    // Heart of data fetching logic, useCallback to prevent it from being recreated on every component render
    const loadImages = useCallback(
        async (currentPage, currentSearchTerm) => {
            if (loading && currentPage > 1) return; // Prevent multiple scroll-fetches
            setLoading(true);

            const isNewSearch = currentPage === 1; // Check if we are loading page 1

            let query = supabase
                .from('media_list')
                .select('id, tags, width, height, source, gcs_url, created_at')
                .order('created_at', { ascending: false });

            const trimmedSearch = currentSearchTerm.trim().toLowerCase(); // If there is a search term, it adds a .contains() filter to the query
            if (trimmedSearch) {
                query = query.contains('tags', [trimmedSearch]);
            }

            // It calculates the range for pagination. For page 1, it fetches items 0-13; for page 2, it fetches 14-28, and so on
            const from = (currentPage - 1) * PAGE_LIMIT;
            const to = from + PAGE_LIMIT - 1;
            query = query.range(from, to);

            const { data, error } = await query; // Doing query...

            if (error) {
                console.error('Error fetching images from Supabase:', error);
                setHasMore(false);
            } else {
                const formattedImages = data.map((img) => ({
                    id: img.id,
                    url: img.gcs_url,
                    title: img.tags[0],
                    source: img.source || 'Unknown',
                    date: new Date(img.created_at).toLocaleDateString(),
                    tags: img.tags || [],
                    width: img.width,
                    height: img.height,
                }));

                // Check if we are loading page 1, replace the old contents if true, otherwise append to the old contents
                if (isNewSearch) {
                    for (let i = formattedImages.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [formattedImages[i], formattedImages[j]] = [formattedImages[j], formattedImages[i]]; // Random the page 1 search
                    }
                    setImages(formattedImages);
                } else {
                    setImages((prev) => [...prev, ...formattedImages]);
                }

                setPage(currentPage + 1);
                setHasMore(formattedImages.length === PAGE_LIMIT); // If less than the PAGE_LIMIT, it means there are no more images to fetch
            }
            setLoading(false);
        },
        [loading]
    );

    // Search effect now depends on the debounced term
    useEffect(() => {
        // This effect now triggers only after the user has paused typing
        setImages([]);
        setPage(1);
        setHasMore(true);
        loadImages(1, debouncedSearchTerm);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [debouncedSearchTerm]);

    // Infinite scroll effect, listens for the user's scroll position and loads more images when they near the bottom
    useEffect(() => {
        const handleScroll = () => {
            if (
                window.innerHeight + document.documentElement.scrollTop >= document.documentElement.offsetHeight - 200 &&
                !loading &&
                hasMore
            ) {
                loadImages(page, debouncedSearchTerm);
            }
            setShowScrollTopButton(window.pageYOffset > 300);
        };
        window.addEventListener('scroll', handleScroll);
        return () => window.removeEventListener('scroll', handleScroll);
    }, [loading, hasMore, page, debouncedSearchTerm, loadImages]);

    // This hook efficiently organizes the flat images array into a nested array of columns for your masonry layout
    const columns = React.useMemo(() => {
        const newColumns = Array.from({ length: numColumns }, () => []);
        images.forEach((image, index) => {
            newColumns[index % numColumns].push(image);
        });
        return newColumns;
    }, [images, numColumns]);

    // Functions for user interaction, primarily related to the image modal
    const handleCloseModal = () => {
        setSelectedImage(null);
        setRotation(0);
    };
    const handleTagClick = (tag) => {
        setSearchTerm(tag); // The debounce hook will handle the rest
        handleCloseModal();
        window.scrollTo(0, 0);
    };
    const handleScrollToTop = () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // When the modal is open, it sets overflow: 'hidden' on the <body> element to prevent the background from scrolling
    useEffect(() => {
        setShowScrollTopButton(false);
        document.body.style.overflow = selectedImage ? 'hidden' : 'auto';
        return () => {
            document.body.style.overflow = 'auto';
        };
    }, [selectedImage]);

    // Functions for going to next or prev image in modal
    const currentImageIndex = selectedImage ? images.findIndex((img) => img.id === selectedImage.id) : -1;

    const handleNextImage = useCallback(
        (e) => {
            if (e) e.stopPropagation();
            const nextIndex = currentImageIndex + 1;
            if (nextIndex < images.length) {
                setSelectedImage(images[nextIndex]);
                setRotation(0);
            }
        },
        [currentImageIndex, images]
    );
    const handlePrevImage = useCallback(
        (e) => {
            if (e) e.stopPropagation();
            const prevIndex = currentImageIndex - 1;
            if (prevIndex >= 0) {
                setSelectedImage(images[prevIndex]);
                setRotation(0);
            }
        },
        [currentImageIndex, images]
    );

    useEffect(() => {
        if (!selectedImage) return;
        const handleKeyDown = (e) => {
            if (e.key === 'ArrowRight') handleNextImage(e);
            else if (e.key === 'ArrowLeft') handlePrevImage(e);
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedImage, handleNextImage, handlePrevImage]);

    const handleTouchStart = (e) => {
        touchEndX.current = 0;
        touchStartX.current = e.targetTouches[0].clientX;
    };
    const handleTouchMove = (e) => {
        touchEndX.current = e.targetTouches[0].clientX;
    };
    const handleTouchEnd = (e) => {
        if (touchEndX.current === 0) return;
        const swipeThreshold = 50;
        const deltaX = touchEndX.current - touchStartX.current;
        if (deltaX > swipeThreshold) handlePrevImage(e);
        else if (deltaX < -swipeThreshold) handleNextImage(e);
    };

    return (
        <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { delay: 0.8, duration: 0.4, ease: 'easeIn' } }}
            className="min-h-[100vh] p-4 sm:p-6 lg:p-8"
        >
            <div className="mx-auto">
                <h1 className="text-3xl font-bold text-center mb-6">My Image Gallery</h1>
                <div className="container mb-8">
                    <div className="relative">
                        <span className="absolute inset-y-0 left-0 flex items-center pl-4">
                            <Search className="text-xl text-gray-400" />
                        </span>
                        <input
                            type="text"
                            placeholder="Search by tag..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)} // Just update the state directly
                            className="w-full pl-14 pr-4 py-3 border border-gray-300 rounded-full shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-shadow"
                        />
                    </div>
                </div>
                <div className="flex flex-row gap-4">
                    {columns.map((columnImages, colIndex) => (
                        <div key={colIndex} className="flex flex-col gap-4 w-full">
                            {columnImages.map((image, imageIndex) => {
                                const overallIndex = imageIndex * numColumns + colIndex;
                                return (
                                    <div
                                        key={image.id}
                                        className="break-inside-avoid overflow-hidden rounded-lg shadow-lg hover:shadow-xl transition-shadow duration-300 ease-in-out cursor-pointer"
                                        onClick={() => setSelectedImage(image)}
                                    >
                                        <Image
                                            src={image.url}
                                            alt={image.title}
                                            width={image.width}
                                            height={image.height}
                                            className="w-full h-auto object-cover transition-opacity duration-300 ease-in-out hover:opacity-75"
                                            sizes="(max-width: 768px) 50vw, (max-width: 1280px) 33vw, 25vw"
                                            priority={overallIndex < 7}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    ))}
                </div>
                {loading && page === 1 && <p className="text-center py-10 text-gray-500 text-lg">Searching...</p>}
                {loading && page > 1 && <p className="text-center py-10 text-gray-500 text-lg">Loading more images...</p>}
                {!hasMore && <p className="text-center py-10 text-gray-500 text-lg">You've reached the end!</p>}
                {!loading && images.length === 0 && (
                    <p className="text-center py-10 text-gray-600 text-xl">
                        {debouncedSearchTerm ? `No images found for "${debouncedSearchTerm}"` : 'No images to display.'}
                    </p>
                )}
            </div>

            {selectedImage && (
                <div
                    className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-80 transition-opacity duration-300"
                    onClick={handleCloseModal}
                >
                    {!isMobile && currentImageIndex > 0 && (
                        <button
                            onClick={handlePrevImage}
                            className="absolute left-6 top-1/2 z-50 -translate-y-1/2 bg-white bg-opacity-30 hover:bg-opacity-50 text-black font-bold p-2 rounded-full w-12 h-12 flex items-center justify-center transition-all duration-300 hover:scale-110"
                            aria-label="Previous image"
                        >
                            <ChevronLeft className="text-xl" />
                        </button>
                    )}

                    <div
                        className="relative p-4 bg-gray-900 bg-opacity-50 rounded-lg flex flex-col items-center"
                        onClick={(e) => e.stopPropagation()}
                        onTouchStart={handleTouchStart}
                        onTouchMove={handleTouchMove}
                        onTouchEnd={handleTouchEnd}
                    >
                        <div className="relative max-w-[90vw] max-h-[80vh] w-auto h-auto aspect-w-1 aspect-h-1">
                            <Image
                                src={selectedImage.url}
                                alt={selectedImage.title}
                                width={selectedImage.width} // Use the direct width
                                height={selectedImage.height} // Use the direct height
                                className="object-contain rounded-lg shadow-2xl transition-transform duration-300 ease-in-out pointer-events-none max-w-[90vw] max-h-[80vh] h-auto sm:w-auto"
                                style={{ transform: `rotate(${rotation}deg)` }}
                                sizes="90vw"
                            />
                        </div>
                        <p className="text-white text-center mt-3 font-semibold">{selectedImage.title}</p>
                        <p className="text-gray-300 text-center text-sm">
                            {selectedImage.date} - from {selectedImage.source}
                        </p>
                    </div>

                    {!isMobile && currentImageIndex < images.length - 1 && (
                        <button
                            onClick={handleNextImage}
                            className="absolute right-6 top-1/2 z-50 -translate-y-1/2 bg-white bg-opacity-30 hover:bg-opacity-50 text-black font-bold p-2 rounded-full w-12 h-12 flex items-center justify-center transition-all duration-300 hover:scale-110"
                            aria-label="Next image"
                        >
                            <ChevronRight className="text-xl" />
                        </button>
                    )}
                    <div className="absolute top-6 right-6 z-50 flex flex-col items-end gap-3">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                setRotation((r) => (r + 90) % 360);
                            }}
                            className="bg-white bg-opacity-30 hover:bg-opacity-50 text-black font-bold p-2 rounded-full w-10 h-10 flex items-center justify-center transition-colors"
                            aria-label="Rotate image"
                        >
                            <RotateCw className="text-xl" />
                        </button>
                        <div className="flex flex-col gap-2 items-end mt-2">
                            {selectedImage.tags.map((tag) => (
                                <button
                                    key={tag}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleTagClick(tag);
                                    }}
                                    className="md:my-1 bg-gray-700 bg-opacity-80 hover:bg-blue-600 text-white text-xs font-semibold py-2 px-4 rounded-full transition-colors duration-200"
                                >
                                    #{tag}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}
            {showScrollTopButton && (
                <button
                    onClick={handleScrollToTop}
                    className="fixed bottom-12 right-12 z-50 bg-blue-500 hover:bg-blue-600 text-white p-4 rounded-full shadow-lg transition-opacity hover:scale-110 duration-300 ease-in-out cursor-pointer"
                    aria-label="Scroll to top"
                >
                    <ChevronsUp className="text-xl" />
                </button>
            )}
        </motion.div>
    );
};

export default Gallery;
