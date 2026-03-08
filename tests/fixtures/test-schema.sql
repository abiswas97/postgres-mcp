-- Create test schema
CREATE SCHEMA IF NOT EXISTS testschema;

-- Users table
CREATE TABLE testschema.users (
    id SERIAL PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    age INTEGER CHECK (age >= 0 AND age <= 150),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Categories table
CREATE TABLE testschema.categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    description TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Posts table with foreign key relationships
CREATE TABLE testschema.posts (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES testschema.users(id) ON DELETE CASCADE,
    category_id INTEGER REFERENCES testschema.categories(id) ON DELETE SET NULL,
    title VARCHAR(200) NOT NULL,
    content TEXT,
    published BOOLEAN DEFAULT FALSE,
    view_count INTEGER DEFAULT 0,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Tags table for many-to-many relationship
CREATE TABLE testschema.tags (
    id SERIAL PRIMARY KEY,
    name VARCHAR(50) NOT NULL UNIQUE,
    color VARCHAR(7) -- Hex color code
);

-- Junction table for posts and tags
CREATE TABLE testschema.post_tags (
    post_id INTEGER NOT NULL REFERENCES testschema.posts(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES testschema.tags(id) ON DELETE CASCADE,
    PRIMARY KEY (post_id, tag_id)
);

-- Create indexes
CREATE INDEX idx_users_email ON testschema.users(email);
CREATE INDEX idx_posts_user_id ON testschema.posts(user_id);
CREATE INDEX idx_posts_category_id ON testschema.posts(category_id);
CREATE INDEX idx_posts_published ON testschema.posts(published);

-- Create a view for testing
CREATE VIEW testschema.published_posts AS
SELECT 
    p.id,
    p.title,
    p.content,
    p.view_count,
    p.created_at,
    u.name as author_name,
    u.email as author_email,
    c.name as category_name
FROM testschema.posts p
JOIN testschema.users u ON p.user_id = u.id
LEFT JOIN testschema.categories c ON p.category_id = c.id
WHERE p.published = TRUE;

CREATE SEQUENCE testschema.test_sequence START 1 MAXVALUE 100;
SELECT setval('testschema.test_sequence', 80)